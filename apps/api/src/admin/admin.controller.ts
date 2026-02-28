import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { AdminService } from "./admin.service";

@Controller("admin")
@UseGuards(AuthGuard("jwt"), RolesGuard)
@Roles("super_admin")
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get("stats")
  getStats() {
    return this.adminService.getStats();
  }

  @Get("tenants")
  listTenants() {
    return this.adminService.listTenants();
  }

  @Get("tenants/:tenantId")
  getTenant(@Param("tenantId") tenantId: string) {
    return this.adminService.getTenant(tenantId);
  }

  @Get("tenants/:tenantId/users")
  getTenantUsers(@Param("tenantId") tenantId: string) {
    return this.adminService.getTenantUsers(tenantId);
  }

  @Delete("tenants/:tenantId")
  @HttpCode(204)
  deleteTenant(@Param("tenantId") tenantId: string) {
    return this.adminService.deleteTenant(tenantId);
  }
}
