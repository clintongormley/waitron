import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Server } from "socket.io";

@WebSocketGateway({ cors: { origin: "*" } })
export class KitchenGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  handleConnection() {}
  handleDisconnect() {}

  emitOrderCreated(payload: unknown) {
    this.server.emit("order.created", payload);
  }

  emitTicketCreated(payload: unknown) {
    this.server.emit("ticket.created", payload);
  }

  emitTicketUpdated(event: "ticket.started" | "ticket.ready", payload: unknown) {
    this.server.emit(event, payload);
  }

  emitOrderUpdated(payload: unknown) {
    this.server.emit("order.updated", payload);
  }
}
