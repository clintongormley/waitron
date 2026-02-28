import { Global, Module } from "@nestjs/common";
import { databaseProvider, DATABASE_TOKEN } from "./database.provider";

@Global()
@Module({
  providers: [databaseProvider],
  exports: [DATABASE_TOKEN],
})
export class DatabaseModule {}
