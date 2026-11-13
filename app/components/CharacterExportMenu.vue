<template>
  <details ref="menu" class="character-export" @click.stop @toggle="positionMenu" @focusout="onFocusOut" @keydown.esc.prevent="closeMenu(true)">
    <summary :aria-busy="busy">{{ busy ? 'Exporting…' : 'Export' }} <span aria-hidden="true">▾</span></summary>
    <div class="export-options" :class="{ 'align-left': alignLeft }" role="menu" :aria-label="kind==='tamer'?'Export Tamer':'Export Digimon'">
      <button type="button" role="menuitem" :disabled="busy" @click="exportChoice('single')">{{ kind==='tamer'?'Tamer only':'This Digimon only' }}</button>
      <button type="button" role="menuitem" :disabled="busy" @click="exportChoice('full')">{{ kind==='tamer'?'Full character bundle':'Full evolution line (no Tamer)' }}</button>
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
  </details>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { Tamer, Digimon } from '~/server/db/schema'
import type { CreationRules } from '~/types'
import { useCharacterBundle } from '~/composables/useCharacterBundle'
import { requestErrorMessage } from '~/utils/requestError'

const props=defineProps<{
  kind:'tamer'|'digimon'
  record:Tamer|Digimon
  rules?:CreationRules|null
  loadRules?:()=>Promise<CreationRules|null|undefined>
}>()
const bundle=useCharacterBundle()
const menu=ref<HTMLDetailsElement|null>(null)
const alignLeft=ref(false)
const busy=ref(false),error=ref('')
function closeMenu(restoreFocus=false){
  if(!menu.value)return
  menu.value.open=false
  if(restoreFocus)menu.value.querySelector('summary')?.focus()
}
function positionMenu(){
  if(menu.value?.open){
    const width=menu.value.querySelector('.export-options')?.getBoundingClientRect().width??240
    alignLeft.value=menu.value.getBoundingClientRect().right-width<12
  }
}
function onFocusOut(event:FocusEvent){if(!menu.value?.contains(event.relatedTarget as Node|null))closeMenu()}
function onOutsidePointer(event:PointerEvent){if(!menu.value?.contains(event.target as Node|null))closeMenu()}
onMounted(()=>document.addEventListener('pointerdown',onOutsidePointer))
onBeforeUnmount(()=>document.removeEventListener('pointerdown',onOutsidePointer))

async function exportChoice(choice:'single'|'full') {
  if(busy.value)return
  busy.value=true;error.value=''
  try {
    const rules=props.loadRules?await props.loadRules():props.rules
    if(props.kind==='tamer') {
      if(choice==='single')bundle.exportTamerBundle(props.record as Tamer,rules)
      else await bundle.exportCharacterBundle(props.record as Tamer,rules)
    } else {
      if(choice==='single')bundle.exportDigimonBundle(props.record as Digimon,rules)
      else await bundle.exportDigimonLineBundle(props.record as Digimon,rules)
    }
    closeMenu()
  } catch(cause){error.value=requestErrorMessage(cause,'Export failed. Please try again.')}
  finally{busy.value=false}
}
</script>

<style scoped>
.character-export{position:relative;display:inline-block;font-size:.875rem;color:#fff}
summary{display:flex;align-items:center;gap:6px;list-style:none;cursor:pointer;background:#002966;border-radius:4px;padding:6px 12px;white-space:nowrap}
summary::-webkit-details-marker{display:none}summary:hover{background:#003d99}
.export-options{position:absolute;top:calc(100% + 5px);right:0;z-index:40;min-width:240px;padding:5px;background:#0a1628;border:1px solid #003d99;border-radius:8px;box-shadow:0 8px 24px #0008}
.export-options.align-left{left:0;right:auto}
button{display:block;width:100%;padding:8px 10px;text-align:left;white-space:nowrap;border-radius:5px}button:hover{background:#002966}button:disabled{opacity:.5;cursor:wait}
summary:focus-visible,button:focus-visible{outline:2px solid #f97316;outline-offset:2px}
p{margin:6px;padding:6px;color:#fca5a5;font-size:12px;max-width:280px;white-space:normal}
</style>
