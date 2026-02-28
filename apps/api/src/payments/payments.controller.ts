import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  RawBodyRequest,
  Request,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { PaymentsService } from "./payments.service";
import { CreatePaymentIntentDto } from "./dto/create-payment-intent.dto";

@Controller("payments")
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post("create-intent")
  @UseGuards(AuthGuard("jwt"))
  createIntent(@Request() req: any, @Body() dto: CreatePaymentIntentDto) {
    return this.paymentsService.createIntent(req.user.tenantId, dto);
  }

  @Get("orders/:locationId/:orderId")
  @UseGuards(AuthGuard("jwt"))
  findByOrder(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("orderId") orderId: string,
  ) {
    return this.paymentsService.findByOrder(
      req.user.tenantId,
      locationId,
      orderId,
    );
  }

  @Post("refund/:locationId/:paymentId")
  @UseGuards(AuthGuard("jwt"))
  refund(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("paymentId") paymentId: string,
  ) {
    return this.paymentsService.refund(
      req.user.tenantId,
      locationId,
      paymentId,
    );
  }

  // Webhooks — no JWT auth, validated by provider signature
  @Post("webhook/stripe")
  stripeWebhook(
    @Request() req: RawBodyRequest<Request>,
    @Headers("stripe-signature") signature: string,
  ) {
    return this.paymentsService.handleStripeWebhook(
      (req as any).rawBody ?? Buffer.from(""),
      signature ?? "",
    );
  }

  @Post("webhook/square")
  squareWebhook(
    @Request() req: RawBodyRequest<Request>,
    @Headers("x-square-hmacsha256-signature") signature: string,
  ) {
    return this.paymentsService.handleSquareWebhook(
      (req as any).rawBody ?? Buffer.from(""),
      signature ?? "",
    );
  }
}
