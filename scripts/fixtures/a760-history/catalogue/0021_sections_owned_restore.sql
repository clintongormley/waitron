INSERT INTO section_members (id, section_id, position, product_id, child_section_id)
  SELECT id, section_id, position, product_id, child_section_id FROM __keep_section_members;--> statement-breakpoint
INSERT INTO menu_details (menu_id, root_section_id, default_home_layout_id)
  SELECT menu_id, root_section_id, default_home_layout_id FROM __keep_menu_details;--> statement-breakpoint
DROP TABLE __keep_section_members;--> statement-breakpoint
DROP TABLE __keep_menu_details;
