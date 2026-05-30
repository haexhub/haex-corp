<script setup lang="ts">
import { computed, ref } from "vue";
import { Plus } from "lucide-vue-next";
import { Button } from "~/components/shadcn/button";
import ProviderIdentityList from "~/components/speckit/ProviderIdentityList.vue";
import ProviderIdentityForm from "~/components/speckit/ProviderIdentityForm.vue";
import {
  useProviderIdentityStore,
  type ProviderIdentity,
} from "~/stores/provider-identity";

const store = useProviderIdentityStore();

type Mode = { kind: "list" } | { kind: "add" } | { kind: "edit"; id: string };
const mode = ref<Mode>({ kind: "list" });

const editingIdentity = computed<ProviderIdentity | undefined>(() => {
  const m = mode.value;
  if (m.kind !== "edit") return undefined;
  return store.identities.find((i) => i.id === m.id);
});

function openAdd() {
  mode.value = { kind: "add" };
}

function openEdit(id: string) {
  mode.value = { kind: "edit", id };
}

function cancel() {
  mode.value = { kind: "list" };
}

function save(value: Omit<ProviderIdentity, "id">) {
  if (mode.value.kind === "edit") {
    store.update(mode.value.id, value);
  } else {
    const newId = store.add(value);
    // First identity becomes active automatically — saves a click for
    // the common single-key case.
    if (store.identities.length === 1) {
      store.setActive(newId);
    }
  }
  mode.value = { kind: "list" };
}

function remove(id: string) {
  store.remove(id);
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">Speckit browser models</h1>
        <p class="mt-1 max-w-prose text-sm text-muted-foreground">
          Provider identities for the browser-side Speckit chat. Keys live
          in this browser only and never reach the Specifyr server. Set one
          active to use it as the model for Speckit chat. Each device needs
          its own setup — there is no cross-device sync.
        </p>
      </div>
      <Button
        v-if="mode.kind === 'list'"
        type="button"
        @click="openAdd"
      >
        <Plus class="size-4" /> Add identity
      </Button>
    </div>

    <ProviderIdentityForm
      v-if="mode.kind === 'add'"
      @save="save"
      @cancel="cancel"
    />

    <ProviderIdentityForm
      v-else-if="mode.kind === 'edit' && editingIdentity"
      :initial="editingIdentity"
      @save="save"
      @cancel="cancel"
    />

    <!--
      Edit mode without a resolvable identity (race: identity removed
      in another tab while edit was open) falls back to the list so the
      page never renders blank.
    -->
    <ProviderIdentityList
      v-if="mode.kind === 'list' || (mode.kind === 'edit' && !editingIdentity)"
      :identities="store.identities"
      :active-identity-id="store.activeIdentityId"
      @edit="openEdit"
      @remove="remove"
      @set-active="store.setActive"
    />
  </div>
</template>
