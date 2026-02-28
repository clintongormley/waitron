import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

export interface TenantRequest extends Request {
  tenantId?: string | null;
  userId?: string;
  userRole?: string;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: TenantRequest, _res: Response, next: NextFunction) {
    // Tenant context is extracted from JWT by Passport strategy.
    // This middleware exists as a hook point for additional
    // tenant validation if needed.
    next();
  }
}
