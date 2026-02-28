import { Controller, Get, Query, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { SearchService } from "./search.service";

@Controller("search")
@UseGuards(AuthGuard("jwt"))
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Get()
  search(
    @Request() req: any,
    @Query("q") q: string,
    @Query("type") type?: string,
  ) {
    return this.searchService.search(req.user.tenantId, q ?? "", type);
  }
}
