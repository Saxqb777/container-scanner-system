create table if not exists workbooks (
  id serial primary key,
  name text not null,
  file bytea not null,
  sheet_name text not null,
  header_row int not null,
  container_col int not null,
  seal_col int not null,
  active boolean not null default true,
  uploaded_at timestamptz not null default now()
);

create table if not exists containers (
  id serial primary key,
  workbook_id int not null references workbooks(id) on delete cascade,
  row_number int not null,
  container_no text not null,
  seal_no text,
  -- Seals in other seal columns of the row (e.g. "Revised Seal"). Read only, but count as used.
  other_seals text[] not null default '{}',
  sealed_at timestamptz
);

alter table containers add column if not exists other_seals text[] not null default '{}';

create index if not exists containers_lookup on containers (workbook_id, container_no);

-- One seal can only ever sit on one container in a sheet.
create unique index if not exists containers_seal_unique
  on containers (workbook_id, seal_no) where seal_no is not null;

create table if not exists audit_log (
  id serial primary key,
  workbook_id int references workbooks(id) on delete cascade,
  action text not null,
  container_no text,
  seal_no text,
  previous_seal text,
  row_number int,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_recent on audit_log (workbook_id, id desc);
