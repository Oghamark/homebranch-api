import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID, ValidateIf } from 'class-validator';

export class BulkBooksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((id: unknown) => (typeof id === 'string' ? id.toLowerCase() : id))
  @IsUUID(undefined, { each: true })
  bookIds: string[];
}

export class BulkShelfDto extends BulkBooksDto {
  @IsUUID()
  shelfId: string;
}

export class BulkOwnerDto extends BulkBooksDto {
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID()
  ownerId: string | null;
}
