-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('REVIEWER', 'SENIOR_REVIEWER', 'PUBLISHER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AdminUserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'REVIEWER',
    "status" "AdminUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_actor_id_key" ON "AdminUser"("actor_id");

-- CreateIndex
CREATE INDEX "AdminUser_email_idx" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminUser_role_status_idx" ON "AdminUser"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_token_hash_key" ON "AdminSession"("token_hash");

-- CreateIndex
CREATE INDEX "AdminSession_user_id_idx" ON "AdminSession"("user_id");

-- CreateIndex
CREATE INDEX "AdminSession_token_hash_idx" ON "AdminSession"("token_hash");

-- CreateIndex
CREATE INDEX "AdminSession_expires_at_revoked_at_idx" ON "AdminSession"("expires_at", "revoked_at");

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "ReviewActor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
