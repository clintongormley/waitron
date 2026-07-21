CREATE TABLE "probe_b" ("id" integer PRIMARY KEY NOT NULL, "a_id" integer REFERENCES "probe_a"("id"));
