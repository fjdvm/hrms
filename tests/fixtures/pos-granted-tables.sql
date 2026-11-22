-- The POS tables HRMS may read through hrms_reader, with only the granted columns (access contract, section 3.3).
CREATE TABLE "Orders" (
  "OrderId" integer PRIMARY KEY, "OrderSource" text NOT NULL, "OrderType" text NOT NULL, "OrderStatus" text NOT NULL, "TotalAmount" numeric(12,2) NOT NULL,
  "SubmittedBy" integer NOT NULL, "LocationId" integer, "ApprovedAt" timestamptz, "CreatedAt" timestamptz NOT NULL, "UpdatedAt" timestamptz
);
CREATE TABLE "OrderItems" (
  "ItemId" integer PRIMARY KEY, "OrderId" integer NOT NULL, "VariationId" integer NOT NULL, "Quantity" integer NOT NULL, "UnitPrice" numeric(12,2) NOT NULL, "Subtotal" numeric(12,2) NOT NULL
);
CREATE TABLE "RefundRequests" (
  "RefundRequestId" integer PRIMARY KEY, "OrderId" integer NOT NULL, "VariationId" integer NOT NULL, "LocationId" integer, "QuantityToReturn" integer NOT NULL,
  "Status" text NOT NULL, "RequestedBy" integer, "ApprovedBy" integer, "ApprovedAt" timestamptz
);
CREATE TABLE "PosStaffUsers" ("Id" integer PRIMARY KEY, "AuthUserId" text NOT NULL);
CREATE TABLE "Locations" ("LocationId" integer PRIMARY KEY, "LocationName" text NOT NULL, "LocationType" text NOT NULL, "IsActive" boolean NOT NULL);
