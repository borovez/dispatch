<script setup lang="ts">
import { computed, reactive } from 'vue'
import { PhFile, PhFileDoc, PhFileImage, PhFilePdf, PhFileXls, PhFileZip, PhFileVideo, PhFileAudio, PhFileCode, PhPaperclip } from '@phosphor-icons/vue'
import type { SlackFile } from '@shared/types'
import { externalHint } from '@/lib/external'

/**
 * The files attached to a Slack message: images as previews (through Dispatch, Slack's file URLs need the
 * token), everything else (and an image whose preview can't load, e.g. without files:read) as a file card.
 * Both open the file in Slack.
 */
const props = defineProps<{ files: SlackFile[] }>()

const broken = reactive(new Set<string>())
const isImage = (f: SlackFile) => f.mimetype.startsWith('image/') && !!f.thumb && !broken.has(f.id)
const images = computed(() => props.files.filter(isImage))
const others = computed(() => props.files.filter((f) => !isImage(f)))

function icon(f: SlackFile) {
  const t = f.filetype.toLowerCase()
  const m = f.mimetype
  if (t === 'pdf') return PhFilePdf
  if (m.startsWith('image/')) return PhFileImage
  if (m.startsWith('video/')) return PhFileVideo
  if (m.startsWith('audio/')) return PhFileAudio
  if (['xls', 'xlsx', 'csv', 'numbers', 'gsheet'].includes(t)) return PhFileXls
  if (['doc', 'docx', 'pages', 'gdoc', 'rtf', 'txt', 'markdown'].includes(t)) return PhFileDoc
  if (['zip', 'gzip', 'tar', 'rar', '7z'].includes(t)) return PhFileZip
  if (['javascript', 'typescript', 'json', 'php', 'python', 'sql', 'html', 'css', 'shell', 'yaml', 'xml', 'post', 'snippet'].includes(t)) return PhFileCode
  return PhFile
}

function size(n: number | null) {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="space-y-1.5">
    <p v-if="files.length > 1" class="flex items-center gap-1 text-xs text-muted-foreground">
      <PhPaperclip /> {{ files.length }} attachments
    </p>
    <div v-if="images.length" class="flex flex-wrap gap-2">
      <a
        v-for="f in images"
        :key="f.id"
        :href="f.permalink ?? undefined"
        target="_blank"
        rel="noopener"
        :title="`${f.name} · ${externalHint(f.permalink)}`"
        data-no-link-preview
        class="block overflow-hidden rounded-md border bg-muted transition-opacity hover:opacity-90"
        @click.stop
      >
        <img
          :src="f.thumb!"
          :alt="f.name"
          :width="f.thumbWidth ?? undefined"
          :height="f.thumbHeight ?? undefined"
          loading="lazy"
          class="block h-auto max-h-48 w-auto max-w-full object-contain"
          @error="broken.add(f.id)"
        />
      </a>
    </div>
    <div v-if="others.length" class="flex flex-wrap gap-2">
      <a
        v-for="f in others"
        :key="f.id"
        :href="f.permalink ?? undefined"
        target="_blank"
        rel="noopener"
        :title="externalHint(f.permalink)"
        data-no-link-preview
        class="flex max-w-72 min-w-0 items-center gap-2.5 rounded-md border bg-card px-2.5 py-2 transition-colors hover:bg-accent"
        @click.stop
      >
        <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <component :is="icon(f)" class="size-5" />
        </span>
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium">{{ f.name }}</span>
          <span class="block text-xs text-muted-foreground uppercase">{{ [f.filetype, size(f.size)].filter(Boolean).join(' · ') }}</span>
        </span>
      </a>
    </div>
  </div>
</template>
