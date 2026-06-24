-- AlterTable: make Token.symbol and Token.name nullable
-- These are display-only fields (never used as accounting identity per architecture rules).
-- Making them nullable allows token records to be created during ingestion even when
-- the RPC metadata fetch for symbol/name fails, preventing sync from blocking on
-- non-essential metadata for non-standard ERC20 tokens.
ALTER TABLE "Token" ALTER COLUMN "symbol" DROP NOT NULL;
ALTER TABLE "Token" ALTER COLUMN "name" DROP NOT NULL;
