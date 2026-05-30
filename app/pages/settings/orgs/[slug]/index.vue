<script setup lang="ts">
import { Copy, Crown, UserMinus, UserPlus } from "lucide-vue-next";
import { Button } from "~/components/shadcn/button";
import { Input } from "~/components/shadcn/input";

interface MemberRow {
  userId: string;
  email: string;
  displayName: string | null;
  role: "admin" | "member";
  joinedAt: string;
}

interface MembersResponse {
  org: {
    id: string;
    slug: string;
    name: string;
    ownerUserId: string;
    createdAt: string;
  };
  myRole: "admin" | "member";
  members: MemberRow[];
}

const route = useRoute();
const slug = computed(() => String(route.params.slug));
const { me } = useMe();

const { data, refresh } = await useFetch<MembersResponse>(
  () => `/api/orgs/${slug.value}/members`,
);

const isOwner = computed(
  () => !!data.value && !!me.value && data.value.org.ownerUserId === me.value.id,
);
const isAdmin = computed(() => data.value?.myRole === "admin");

const memberError = ref<string | null>(null);

async function patchRole(userId: string, role: "admin" | "member") {
  memberError.value = null;
  try {
    await $fetch(`/api/orgs/${slug.value}/members/${userId}/role`, {
      method: "PATCH",
      body: { role },
    });
    await refresh();
  } catch (err: unknown) {
    memberError.value =
      (err as { statusMessage?: string })?.statusMessage ??
      (err instanceof Error ? err.message : "could not update role");
  }
}

async function removeMember(userId: string, label: string) {
  if (!confirm(`Remove ${label} from this organization?`)) return;
  memberError.value = null;
  try {
    await $fetch(`/api/orgs/${slug.value}/members/${userId}`, {
      method: "DELETE",
    });
    await refresh();
  } catch (err: unknown) {
    memberError.value =
      (err as { statusMessage?: string })?.statusMessage ??
      (err instanceof Error ? err.message : "could not remove member");
  }
}

const transferTarget = ref<string>("");
const transferring = ref(false);
const transferError = ref<string | null>(null);

async function transferOwnership() {
  if (!transferTarget.value) return;
  if (
    !confirm(
      "Transfer ownership? You will keep admin rights but lose owner privileges (you can no longer be promoted back without the new owner transferring it back).",
    )
  ) {
    return;
  }
  transferring.value = true;
  transferError.value = null;
  try {
    await $fetch(`/api/orgs/${slug.value}/transfer-ownership`, {
      method: "POST",
      body: { newOwnerUserId: transferTarget.value },
    });
    transferTarget.value = "";
    await refresh();
  } catch (err: unknown) {
    transferError.value =
      (err as { statusMessage?: string })?.statusMessage ??
      (err instanceof Error ? err.message : "could not transfer");
  } finally {
    transferring.value = false;
  }
}

const inviteEmail = ref("");
const inviteRole = ref<"admin" | "member">("member");
const inviting = ref(false);
const inviteError = ref<string | null>(null);
const inviteResult = ref<{ acceptPath: string; expiresAt: string } | null>(null);
const copied = ref(false);

async function sendInvite() {
  inviteError.value = null;
  inviteResult.value = null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inviteEmail.value.trim())) {
    inviteError.value = "Please enter a valid email.";
    return;
  }
  inviting.value = true;
  try {
    const res = await $fetch<{ acceptPath: string; expiresAt: string }>(
      `/api/orgs/${slug.value}/invites`,
      {
        method: "POST",
        body: { email: inviteEmail.value.trim(), role: inviteRole.value },
      },
    );
    inviteResult.value = res;
    inviteEmail.value = "";
  } catch (err: unknown) {
    inviteError.value =
      (err as { statusMessage?: string })?.statusMessage ?? "could not create invite";
  } finally {
    inviting.value = false;
  }
}

// Volar can't narrow `data` inside filter callbacks, so we precompute
// the transferable-members list as a typed computed.
const transferableMembers = computed(() =>
  data.value
    ? data.value.members.filter(
        (m) => m.userId !== data.value!.org.ownerUserId,
      )
    : [],
);

const inviteUrl = computed(() => {
  if (!inviteResult.value) return "";
  if (typeof window === "undefined") return inviteResult.value.acceptPath;
  return `${window.location.origin}${inviteResult.value.acceptPath}`;
});

async function copyLink() {
  if (!inviteUrl.value) return;
  try {
    await navigator.clipboard.writeText(inviteUrl.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // Clipboard permission denied (e.g. non-secure context, browser
    // policy). Surface a hint via the existing error slot so the user
    // can copy manually instead of the action silently failing.
    inviteError.value = "Clipboard access denied. Copy the link manually.";
  }
}
</script>

<template>
  <div>
    <NuxtLink
      to="/settings/orgs"
      class="text-xs text-muted-foreground hover:text-foreground"
    >
      ← Organizations
    </NuxtLink>

    <template v-if="data">
      <h1 class="mt-2 text-2xl font-semibold">{{ data.org.name }}</h1>
      <p class="mt-1 text-sm text-muted-foreground">
        <span class="font-mono">/{{ data.org.slug }}</span> · You are
        <span class="font-medium">{{ data.myRole }}</span>
      </p>

      <section class="mt-8">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Members ({{ data.members.length }})
        </h2>
        <ul class="mt-3 divide-y divide-border rounded-lg border border-border">
          <li
            v-for="m in data.members"
            :key="m.userId"
            class="flex items-center justify-between gap-3 px-4 py-3"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-2 text-sm font-medium">
                <span class="truncate">{{ m.displayName || m.email }}</span>
                <span
                  v-if="m.userId === data.org.ownerUserId"
                  class="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600"
                  title="Org owner — cannot be removed or demoted; transfer ownership first."
                >
                  <Crown class="size-3" /> owner
                </span>
              </div>
              <div class="truncate font-mono text-xs text-muted-foreground">
                {{ m.email }}
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="rounded-md px-2 py-0.5 text-xs font-medium"
                :class="m.role === 'admin' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
              >
                {{ m.role }}
              </span>
              <template v-if="isAdmin && m.userId !== data.org.ownerUserId">
                <Button
                  v-if="m.role === 'member'"
                  size="sm"
                  variant="outline"
                  @click="patchRole(m.userId, 'admin')"
                >
                  Promote
                </Button>
                <Button
                  v-else
                  size="sm"
                  variant="outline"
                  @click="patchRole(m.userId, 'member')"
                >
                  Demote
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-destructive hover:bg-destructive/10"
                  :title="`Remove ${m.email}`"
                  @click="removeMember(m.userId, m.displayName || m.email)"
                >
                  <UserMinus class="size-4" />
                </Button>
              </template>
            </div>
          </li>
        </ul>
        <p v-if="memberError" class="mt-2 text-sm text-destructive">{{ memberError }}</p>
      </section>

      <section v-if="data.myRole === 'admin'" class="mt-8">
        <h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <UserPlus class="size-4" /> Invite a member
        </h2>
        <form
          class="mt-3 grid gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-[1fr_auto_auto]"
          @submit.prevent="sendInvite"
        >
          <Input
            v-model="inviteEmail"
            type="email"
            placeholder="colleague@example.com"
            :disabled="inviting"
          />
          <select
            v-model="inviteRole"
            class="rounded-md border border-input bg-background px-3 text-sm"
            :disabled="inviting"
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <Button type="submit" :disabled="inviting">
            {{ inviting ? "Creating…" : "Create invite" }}
          </Button>
        </form>
        <p v-if="inviteError" class="mt-2 text-sm text-destructive">
          {{ inviteError }}
        </p>

        <div
          v-if="inviteResult"
          class="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
        >
          <p class="text-sm">
            Invite created. Send this link to your colleague — they need to be
            logged in via Authelia to redeem it.
          </p>
          <div class="mt-2 flex items-center gap-2">
            <code class="flex-1 truncate rounded-md bg-background px-2 py-1.5 text-xs">{{
              inviteUrl
            }}</code>
            <Button size="sm" variant="outline" type="button" @click="copyLink">
              <Copy class="size-3.5" /> {{ copied ? "Copied!" : "Copy" }}
            </Button>
          </div>
          <p class="mt-2 text-xs text-muted-foreground">
            Expires {{ new Date(inviteResult.expiresAt).toLocaleString() }}
          </p>
        </div>
      </section>

      <section
        v-if="isOwner && transferableMembers.length > 0"
        class="mt-12 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
      >
        <h2 class="text-sm font-semibold uppercase tracking-wide text-destructive">
          Danger zone
        </h2>
        <p class="mt-2 text-sm">
          Transfer ownership to another member. You'll keep admin rights but
          lose owner privileges (you'll be removable, the new owner won't).
        </p>
        <form
          class="mt-3 flex flex-wrap items-center gap-2"
          @submit.prevent="transferOwnership"
        >
          <select
            v-model="transferTarget"
            class="rounded-md border border-input bg-background px-3 py-2 text-sm"
            :disabled="transferring"
          >
            <option value="">Select new owner…</option>
            <option
              v-for="m in transferableMembers"
              :key="m.userId"
              :value="m.userId"
            >
              {{ m.displayName || m.email }} ({{ m.email }})
            </option>
          </select>
          <Button
            type="submit"
            variant="destructive"
            size="sm"
            :disabled="!transferTarget || transferring"
          >
            {{ transferring ? "Transferring…" : "Transfer ownership" }}
          </Button>
        </form>
        <p v-if="transferError" class="mt-2 text-sm text-destructive">
          {{ transferError }}
        </p>
      </section>
    </template>

    <p v-else class="mt-4 text-sm text-muted-foreground">Loading…</p>
  </div>
</template>
