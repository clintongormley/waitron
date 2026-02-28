import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { TenantModule } from './tenant/tenant.module';
import { LocationsModule } from './locations/locations.module';
import { TablesModule } from './tables/tables.module';
import { MenuModule } from './menu/menu.module';
import { BookingsModule } from './bookings/bookings.module';
import { OrdersModule } from './orders/orders.module';
import { PublicModule } from './public/public.module';
import { KitchenModule } from './kitchen/kitchen.module';

@Module({
  imports: [DatabaseModule, AuthModule, TenantModule, LocationsModule, TablesModule, MenuModule, BookingsModule, OrdersModule, PublicModule, KitchenModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
