import type { Database, Transaction } from "./client.js";
import { sql } from "drizzle-orm";
import { quoteLiteral, type ChangeSource } from "@waitron/shared";

/**
 * Install as the table owner. Events identify changed resources; business values stay in the DB.
 *
 * The trigger writes its event into `change_log` in the caller's own transaction; `withTransaction`
 * takes the rows out again and hands them to this process's listeners once the commit has returned
 * (`./change-log.ts`). It does not signal out of the database, so a change is never seen by anyone
 * before the transaction that caused it has committed.
 *
 * `change_log` itself must never be one of `sources` — see `CORE_CHANGE_SOURCES` in
 * `./classification.ts`, which filters it out, and the test that pins that.
 */
export async function installChangeFeed(
  db: Database | Transaction,
  sources: readonly ChangeSource[],
): Promise<void> {
  await db.execute(sql`
    create or replace function public.waitron_notify_change() returns trigger
    language plpgsql as $function$
    declare
      changed_row jsonb;
      related jsonb;
      resources jsonb;
      related_id text;
    begin
      if TG_OP = 'UPDATE' and NEW is not distinct from OLD then return null; end if;
      for changed_row in
        select value from jsonb_array_elements(
          case TG_OP
            when 'INSERT' then jsonb_build_array(to_jsonb(NEW))
            when 'DELETE' then jsonb_build_array(to_jsonb(OLD))
            else jsonb_build_array(to_jsonb(OLD), to_jsonb(NEW))
          end
        )
      loop
        resources := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'type', TG_ARGV[0], 'id', changed_row ->> 'id'
        )));
        for related in select value from jsonb_array_elements(TG_ARGV[1]::jsonb)
        loop
          related_id := changed_row ->> (related ->> 'column');
          if related_id is not null then
            resources := resources || jsonb_build_array(jsonb_build_object(
              'type', related ->> 'type', 'id', related_id
            ));
          end if;
        end loop;
        insert into public.change_log (payload)
        values (jsonb_build_object('resources', resources));
      end loop;
      return null;
    end
    $function$
  `);
  for (const source of sources) {
    // CREATE TRIGGER takes literal arguments, not bind parameters.
    const argumentsSql = sql.raw(
      `${quoteLiteral(source.type)}, ${quoteLiteral(JSON.stringify(source.related ?? []))}`,
    );
    await db.execute(sql`
      create or replace trigger waitron_change
      after insert or update or delete on public.${sql.identifier(source.table)}
      for each row execute function public.waitron_notify_change(${argumentsSql})
    `);
    await db.execute(
      sql`alter table public.${sql.identifier(source.table)} enable always trigger waitron_change`,
    );
  }
}
