import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Request,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Response } from "express";
import * as QRCode from "qrcode";
import { TablesService } from "./tables.service";
import { CreateTableDto } from "./dto/create-table.dto";
import { UpdateTableDto } from "./dto/update-table.dto";

@Controller("locations/:locationId/tables")
@UseGuards(AuthGuard("jwt"))
export class TablesController {
  constructor(private tablesService: TablesService) {}

  @Post()
  create(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Body() dto: CreateTableDto,
  ) {
    return this.tablesService.create(req.user.tenantId, locationId, dto);
  }

  @Get()
  findAll(@Request() req: any, @Param("locationId") locationId: string) {
    return this.tablesService.findAll(req.user.tenantId, locationId);
  }

  @Get(":id")
  findOne(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("id") id: string,
  ) {
    return this.tablesService.findOne(req.user.tenantId, locationId, id);
  }

  @Patch(":id")
  update(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("id") id: string,
    @Body() dto: UpdateTableDto,
  ) {
    return this.tablesService.update(req.user.tenantId, locationId, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("id") id: string,
  ) {
    return this.tablesService.remove(req.user.tenantId, locationId, id);
  }

  @Get(":id/qr")
  async getQrCode(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const table = await this.tablesService.findOne(
      req.user.tenantId,
      locationId,
      id,
    );
    const url = `${process.env.APP_URL || "http://localhost:3001"}/table/${table.qrCodeId}`;
    const png = await QRCode.toBuffer(url, { type: "png", width: 300 });
    res.setHeader("Content-Type", "image/png");
    res.send(png);
  }
}
