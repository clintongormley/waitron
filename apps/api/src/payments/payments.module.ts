import { Module } from "@nestjs/common";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { StripeProvider } from "./providers/stripe.provider";
import { SquareProvider } from "./providers/square.provider";
import { MockProvider } from "./providers/mock.provider";

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeProvider, SquareProvider, MockProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
