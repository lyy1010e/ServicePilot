use super::*;

impl ServicePilotBackend {
    pub(crate) async fn save_group(&self, input: SaveGroupInput) -> BackendResult<ServiceGroup> {
        let mut ids = Vec::new();
        let services = self.list_services().await;
        let service_set: HashSet<String> = services.into_iter().map(|service| service.id).collect();
        for service_id in input.service_ids {
            if service_set.contains(&service_id) && !ids.contains(&service_id) {
                ids.push(service_id);
            }
        }

        let group = ServiceGroup {
            id: input.id.unwrap_or_else(new_id),
            name: input.name.trim().to_string(),
            service_ids: ids,
        };

        self.validate_group(&group).await?;

        {
            let mut inner = self.inner.lock().await;
            if let Some(index) = inner.groups.iter().position(|item| item.id == group.id) {
                inner.groups[index] = group.clone();
            } else {
                inner.groups.push(group.clone());
            }
        }

        self.persist_state().await?;
        self.emit_snapshot().await;
        Ok(group)
    }

    pub(crate) async fn delete_group(&self, group_id: &str) -> BackendResult<()> {
        {
            let mut inner = self.inner.lock().await;
            if !inner.groups.iter().any(|group| group.id == group_id) {
                return Err("分组不存在。".to_string());
            }
            inner.groups.retain(|group| group.id != group_id);
        }
        self.persist_state().await?;
        self.emit_snapshot().await;
        Ok(())
    }

    pub(crate) async fn move_group(
        &self,
        group_id: &str,
        target_index: usize,
    ) -> BackendResult<()> {
        {
            let mut inner = self.inner.lock().await;
            let current_index = inner
                .groups
                .iter()
                .position(|group| group.id == group_id)
                .ok_or_else(|| "Group not found.".to_string())?;

            if inner.groups.len() <= 1 {
                return Ok(());
            }

            let bounded_index = target_index.min(inner.groups.len() - 1);
            if bounded_index == current_index {
                return Ok(());
            }

            let group = inner.groups.remove(current_index);
            inner.groups.insert(bounded_index, group);
        }
        self.persist_state().await?;
        self.emit_snapshot().await;
        Ok(())
    }

    pub(crate) async fn set_service_group_membership(
        &self,
        service_id: &str,
        group_ids: Vec<String>,
    ) -> BackendResult<()> {
        {
            let mut inner = self.inner.lock().await;
            if !inner
                .services
                .iter()
                .any(|service| service.id == service_id)
            {
                return Err("Service not found.".to_string());
            }

            let target_group_ids = group_ids.into_iter().collect::<HashSet<_>>();
            for group in &mut inner.groups {
                let should_include = target_group_ids.contains(&group.id);
                let currently_included = group.service_ids.iter().any(|id| id == service_id);
                if should_include && !currently_included {
                    group.service_ids.push(service_id.to_string());
                } else if !should_include && currently_included {
                    group.service_ids.retain(|id| id != service_id);
                }
            }
        }

        self.persist_state().await?;
        self.emit_snapshot().await;
        Ok(())
    }

    pub(crate) async fn add_services_to_groups(
        &self,
        service_ids: Vec<String>,
        group_ids: Vec<String>,
    ) -> BackendResult<()> {
        let service_ids = service_ids.into_iter().collect::<HashSet<_>>();
        let group_ids = group_ids.into_iter().collect::<HashSet<_>>();
        if service_ids.is_empty() || group_ids.is_empty() {
            return Ok(());
        }

        {
            let mut inner = self.inner.lock().await;
            let existing_service_ids = inner
                .services
                .iter()
                .map(|service| service.id.clone())
                .collect::<HashSet<_>>();
            let valid_service_ids = service_ids
                .into_iter()
                .filter(|service_id| existing_service_ids.contains(service_id))
                .collect::<Vec<_>>();

            for group in &mut inner.groups {
                if !group_ids.contains(&group.id) {
                    continue;
                }
                for service_id in &valid_service_ids {
                    if !group.service_ids.contains(service_id) {
                        group.service_ids.push(service_id.clone());
                    }
                }
            }
        }

        self.persist_state().await?;
        self.emit_snapshot().await;
        Ok(())
    }

    pub(crate) async fn start_group(&self, group_id: &str) -> BackendResult<()> {
        let group = self.require_group(group_id).await?;
        for service_id in group.service_ids {
            self.start_service(&service_id).await?;
            sleep(Duration::from_millis(300)).await;
        }
        Ok(())
    }

    pub(crate) async fn stop_group(&self, group_id: &str) -> BackendResult<()> {
        let group = self.require_group(group_id).await?;
        for service_id in group.service_ids.into_iter().rev() {
            self.stop_service(&service_id).await?;
            sleep(Duration::from_millis(200)).await;
        }
        Ok(())
    }

    async fn require_group(&self, group_id: &str) -> BackendResult<ServiceGroup> {
        let inner = self.inner.lock().await;
        inner
            .groups
            .iter()
            .find(|group| group.id == group_id)
            .cloned()
            .ok_or_else(|| "分组不存在。".to_string())
    }
}
