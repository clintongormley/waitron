import { Module } from "@nestjs/common";
import { PublicController } from "./public.controller";
import { OrdersModule } from "../orders/orders.module";

@Module({
  imports: [OrdersModule],
  controllers: [PublicController],
})
export class PublicModule {}
