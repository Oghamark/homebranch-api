import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from 'src/app.module';
import { BookClubsModule } from 'src/modules/book-clubs/book-clubs.module';

describe('BookClubsModule application wiring', () => {
  it('registers the instance-local Book Clubs API in AppModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];
    expect(imports).toContain(BookClubsModule);
  });
});
