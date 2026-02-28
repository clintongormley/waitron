import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { TenantModule } from './tenant/tenant.module';
import { LocationsModule } from './locations/locations.module';
import { TablesModule } from './tables/tables.module';
import { MenuModule } from './menu/menu.module';

@Module({
  imports: [DatabaseModule, AuthModule, TenantModule, LocationsModule, TablesModule, MenuModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
