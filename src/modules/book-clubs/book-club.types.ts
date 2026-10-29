export enum BookClubRole {
  OWNER = 'owner',
  MODERATOR = 'moderator',
  MEMBER = 'member',
}

export enum BookClubVisibility {
  PRIVATE = 'private',
  INSTANCE_VISIBLE = 'instance_visible',
}

export enum BookClubStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

export enum BookClubReadingCopySource {
  NONE = 'none',
  SHARED = 'shared',
  PERSONAL = 'personal',
}

export enum BookClubAssociationMethod {
  IDENTIFIER = 'identifier',
  METADATA_CANDIDATE = 'metadata_candidate',
  MANUAL_CONFIRMATION = 'manual_confirmation',
}
