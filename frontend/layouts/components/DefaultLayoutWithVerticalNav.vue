<script lang="ts" setup>
import NavItems from '@/layouts/components/NavItems.vue'
import logo from '@images/logo.svg?raw'
import VerticalNavLayout from '@layouts/components/VerticalNavLayout.vue'

import Footer from '@/layouts/components/Footer.vue'
import NavbarThemeSwitcher from '@/layouts/components/NavbarThemeSwitcher.vue'
import ConnectionStatus from '~/components/import/ConnectionStatus.vue'
</script>

<template>
  <VerticalNavLayout>
    <template #navbar="{ toggleVerticalOverlayNavActive }">
      <div class="d-flex h-100 align-center gap-2">
        <IconBtn
          class="ms-n3 d-lg-none"
          aria-label="Abrir menu"
          @click="toggleVerticalOverlayNavActive(true)"
        >
          <VIcon icon="ri-menu-line" />
        </IconBtn>

        <span class="text-h6 d-none d-md-inline">Importação de usuários em lote</span>

        <VSpacer />

        <ConnectionStatus />
        <NavbarThemeSwitcher />
      </div>
    </template>

    <template #vertical-nav-header="{ toggleIsOverlayNavActive }">
      <NuxtLink
        to="/"
        class="app-logo app-title-wrapper"
      >
        <!-- eslint-disable vue/no-v-html -->
        <div
          class="d-flex"
          aria-hidden="true"
          v-html="logo"
        />
        <!-- eslint-enable -->

        <span class="font-weight-medium leading-normal text-lg">
          Importador RH-SSO
        </span>
      </NuxtLink>

      <IconBtn
        class="d-block d-lg-none"
        aria-label="Fechar menu"
        @click="toggleIsOverlayNavActive(false)"
      >
        <VIcon icon="ri-close-line" />
      </IconBtn>
    </template>

    <template #vertical-nav-content>
      <NavItems />
    </template>

    <slot />

    <template #footer>
      <Footer />
    </template>
  </VerticalNavLayout>
</template>

<style lang="scss" scoped>
.app-logo {
  display: flex;
  align-items: center;
  column-gap: 0.75rem;
}
</style>
