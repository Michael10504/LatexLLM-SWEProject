CREATE TABLE "CloudCredential" (
 "username" TEXT NOT NULL PRIMARY KEY,
 "provider" TEXT NOT NULL,
 "endpoint" TEXT NOT NULL,
 "model" TEXT NOT NULL,
 "encryptedKey" TEXT NOT NULL,
 CONSTRAINT "CloudCredential_username_fkey" FOREIGN KEY ("username") REFERENCES "User" ("username") ON DELETE CASCADE ON UPDATE CASCADE
);
