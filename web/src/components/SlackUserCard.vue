<script setup lang="ts">
import { ref } from 'vue'
import { PhArrowSquareOut, PhChatCircle, PhCopy, PhEnvelopeSimple } from '@phosphor-icons/vue'
import type { SlackUserProfile } from '@shared/types'
import { api } from '@/api'
import { copyText } from '@/composables/itemMenus'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'

/** Click the slot (an avatar or a name) for a Slack user's card: name, title, email, profile and DM links */
const props = defineProps<{ userId: string; name: string; avatar?: string | null }>()

const profile = ref<SlackUserProfile | null>(null)
const error = ref('')
async function open(o: boolean) {
  if (!o || profile.value || !props.userId) return
  error.value = ''
  try {
    profile.value = await loadProfile(props.userId)
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>

<script lang="ts">
/** One request per user for this page session */
const profiles = new Map<string, Promise<SlackUserProfile>>()
function loadProfile(id: string) {
  if (!profiles.has(id)) profiles.set(id, api.slackUser(id).catch((e) => (profiles.delete(id), Promise.reject(e))))
  return profiles.get(id)!
}
</script>

<template>
  <!-- Bots and unknown senders have no profile -->
  <slot v-if="!userId" />
  <Popover v-else @update:open="open">
    <PopoverTrigger as-child>
      <button type="button" class="shrink-0 cursor-pointer self-start rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" :aria-label="`${name}: profile`">
        <slot />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-72">
      <div class="flex items-center gap-3">
        <Avatar class="size-12 shrink-0">
          <AvatarImage v-if="profile?.avatar ?? avatar" :src="(profile?.avatar ?? avatar)!" :alt="name" />
          <AvatarFallback>{{ name.slice(0, 2).toUpperCase() }}</AvatarFallback>
        </Avatar>
        <div class="min-w-0">
          <p class="truncate font-semibold">{{ profile?.name ?? name }}</p>
          <p v-if="profile?.realName && profile.realName !== profile.name" class="truncate text-sm text-muted-foreground">{{ profile.realName }}</p>
          <p v-if="profile?.title" class="truncate text-xs text-muted-foreground">{{ profile.title }}</p>
        </div>
      </div>
      <div class="mt-3 space-y-2 text-sm">
        <template v-if="profile">
          <div v-if="profile.email" class="flex items-center gap-1">
            <a :href="`mailto:${profile.email}`" class="flex min-w-0 flex-1 items-center gap-2 text-primary hover:underline">
              <PhEnvelopeSimple class="shrink-0" /><span class="truncate">{{ profile.email }}</span>
            </a>
            <Button variant="ghost" size="icon-xs" aria-label="Copy email" @click="copyText(profile.email, 'email')"><PhCopy /></Button>
          </div>
          <p v-else class="text-xs text-muted-foreground">No email (Slack needs the users:read.email scope, or it's hidden)</p>
        </template>
        <p v-else-if="error" class="text-xs text-destructive">{{ error }}</p>
        <Skeleton v-else class="h-4 w-48" />
      </div>
      <div v-if="profile?.profileUrl || profile?.dmUrl" class="mt-3 flex gap-2">
        <Button v-if="profile.profileUrl" size="sm" variant="outline" class="flex-1" as="a" :href="profile.profileUrl" target="_blank" rel="noopener">
          <PhArrowSquareOut /> View profile
        </Button>
        <Button v-if="profile.dmUrl" size="sm" variant="outline" class="flex-1" as="a" :href="profile.dmUrl"><PhChatCircle /> Message</Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
