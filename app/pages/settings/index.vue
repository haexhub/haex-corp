<script setup lang="ts">
import { Building2, LogIn, LogOut, MessageSquareCode, ShieldCheck, User as UserIcon } from "lucide-vue-next";

const { me, isDevAuth, logout, devLogin } = useMe();
</script>

<template>
  <div>
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">Settings</h1>
        <p v-if="me" class="mt-1 text-sm text-muted-foreground">
          Logged in as <span class="font-mono">{{ me.email }}</span>
        </p>
        <p v-else class="mt-1 text-sm text-destructive">
          Not authenticated. Settings require an IDP login (or
          <span class="font-mono">SPECIFYR_DEV_USER_EMAIL</span> in dev).
        </p>
      </div>
      <button
        v-if="me"
        type="button"
        class="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
        @click="logout()"
      >
        <LogOut class="size-4" /> Logout
      </button>
      <button
        v-else-if="isDevAuth"
        type="button"
        class="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm transition hover:bg-primary/10"
        @click="devLogin()"
      >
        <LogIn class="size-4" /> Sign in (dev)
      </button>
    </div>

    <ul class="mt-8 grid gap-3 sm:grid-cols-1">
      <li>
        <NuxtLink
          to="/settings/orgs"
          class="flex items-start gap-3 rounded-lg border border-border p-4 transition hover:bg-accent/50"
        >
          <Building2 class="mt-0.5 size-5 shrink-0 opacity-80" />
          <div>
            <div class="font-medium">Organizations</div>
            <div class="mt-0.5 text-sm text-muted-foreground">
              Create orgs, invite members, share LLM credentials within a team.
            </div>
          </div>
        </NuxtLink>
      </li>
      <li>
        <NuxtLink
          to="/settings/speckit-agent"
          class="flex items-start gap-3 rounded-lg border border-border p-4 transition hover:bg-accent/50"
        >
          <MessageSquareCode class="mt-0.5 size-5 shrink-0 opacity-80" />
          <div>
            <div class="font-medium">Speckit browser models</div>
            <div class="mt-0.5 text-sm text-muted-foreground">
              Browser-side LLM provider identities for the Speckit chat.
              Keys stay in this browser; the Specifyr server never sees them.
            </div>
          </div>
        </NuxtLink>
      </li>
      <li>
        <NuxtLink
          to="/settings/me/profile"
          class="flex items-start gap-3 rounded-lg border border-border p-4 transition hover:bg-accent/50"
        >
          <UserIcon class="mt-0.5 size-5 shrink-0 opacity-80" />
          <div>
            <div class="font-medium">Profile</div>
            <div class="mt-0.5 text-sm text-muted-foreground">
              Edit your display name shown to org members.
            </div>
          </div>
        </NuxtLink>
      </li>
      <li v-if="me?.isPlatformAdmin">
        <NuxtLink
          to="/admin"
          class="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 transition hover:bg-amber-500/10"
        >
          <ShieldCheck class="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div>
            <div class="font-medium">Platform admin</div>
            <div class="mt-0.5 text-sm text-muted-foreground">
              All users + orgs, registration policy, future
              platform-wide settings. Visible only to platform admins.
            </div>
          </div>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
