import { join } from "path";
import { Module } from '@nestjs/common';
import { I18nModule, AcceptLanguageResolver, HeaderResolver } from "nestjs-i18n";
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
import { PaymentsModule } from './payments/payments.module';
import { SearchModule } from './search/search.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    I18nModule.forRoot({
      fallbackLanguage: "en",
      loaderOptions: {
        path: join(__dirname, "/i18n/"),
        watch: false,
      },
      resolvers: [AcceptLanguageResolver, new HeaderResolver(["x-lang"])],
    }),
    DatabaseModule, AuthModule, TenantModule, LocationsModule, TablesModule, MenuModule, BookingsModule, OrdersModule, PublicModule, KitchenModule, PaymentsModule, SearchModule, AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
