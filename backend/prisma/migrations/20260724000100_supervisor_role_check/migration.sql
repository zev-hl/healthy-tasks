-- Defense-in-depth for the rule "a supervisor must be a Manager or Admin".
-- The application layer (user.service.ts) is the primary enforcement point and
-- returns friendly errors; this trigger guarantees the invariant even against
-- direct SQL / future code paths. It intentionally checks only role + existence
-- + self-reference (not isActive), leaving the softer "active" check to the app
-- so that unrelated edits to a report whose supervisor later deactivates don't
-- fail at the DB layer.

CREATE OR REPLACE FUNCTION check_supervisor_role() RETURNS TRIGGER AS $$
DECLARE
  sup_role "Role";
BEGIN
  IF NEW."supervisorId" IS NOT NULL THEN
    IF NEW."supervisorId" = NEW."id" THEN
      RAISE EXCEPTION 'A user cannot be their own supervisor';
    END IF;

    SELECT "role" INTO sup_role FROM "User" WHERE "id" = NEW."supervisorId";

    IF sup_role IS NULL THEN
      RAISE EXCEPTION 'Supervisor % does not exist', NEW."supervisorId";
    END IF;

    IF sup_role NOT IN ('Admin', 'Manager') THEN
      RAISE EXCEPTION 'Supervisor must be a Manager or Admin (selected user is a %)', sup_role;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_supervisor_role_check
BEFORE INSERT OR UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION check_supervisor_role();
