import type { ServiceGroup } from '@shared/models';

export type GroupFormState = {
  id?: string;
  name: string;
  serviceIds: string[];
};

export type ServiceGroupFormState = {
  serviceId: string;
  groupIds: string[];
};

export function buildGroupForm(group?: ServiceGroup): GroupFormState {
  return {
    id: group?.id,
    name: group?.name ?? '',
    serviceIds: group?.serviceIds ?? []
  };
}

export function buildServiceGroupForm(serviceId: string, groups: ServiceGroup[]): ServiceGroupFormState {
  return {
    serviceId,
    groupIds: groups.filter((group) => group.serviceIds.includes(serviceId)).map((group) => group.id)
  };
}
