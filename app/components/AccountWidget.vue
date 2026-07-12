<template>
  <div class="account-widget">
    <template v-if="isAuthenticated">
      <button class="widget-btn" @click="menuOpen = !menuOpen">
        👤 {{ user?.username }}
      </button>
      <div v-if="menuOpen" class="widget-menu">
        <button class="widget-menu-item" @click="handleLogout">Log Out</button>
      </div>
    </template>
    <NuxtLink v-else to="/auth/login" class="widget-btn">
      Log In / Register
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
const { user, isAuthenticated, fetchMe, logout, initialized } = useAuth()
const menuOpen = ref(false)

onMounted(() => {
  if (!initialized.value) fetchMe()
})

async function handleLogout() {
  menuOpen.value = false
  await logout()
}
</script>

<style scoped>
.account-widget {
  position: fixed;
  top: 8px;
  right: 8px;
  z-index: 45;
  font-size: 0.75rem;
}

.widget-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 9999px;
  background: rgba(30, 30, 35, 0.85);
  border: 1px solid rgba(245, 166, 35, 0.35);
  color: #e5e5e5;
  cursor: pointer;
  white-space: nowrap;
}

.widget-btn:hover {
  border-color: rgba(245, 166, 35, 0.7);
  color: #fff;
}

.widget-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: rgba(24, 24, 27, 0.97);
  border: 1px solid rgba(245, 166, 35, 0.35);
  border-radius: 8px;
  overflow: hidden;
  min-width: 100px;
}

.widget-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 12px;
  color: #e5e5e5;
  background: transparent;
  border: none;
  cursor: pointer;
}

.widget-menu-item:hover {
  background: rgba(245, 166, 35, 0.15);
  color: #fff;
}
</style>
