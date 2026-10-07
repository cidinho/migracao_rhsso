<script lang="ts" setup>
import VerticalNavLink from '@layouts/components/VerticalNavLink.vue'
</script>

<template>
  <VerticalNavLink
    :item="{
      title: 'Importação simples',
      icon: 'ri-user-add-line',
      to: '/',
    }"
  />
  <VerticalNavLink
    :item="{
      title: 'Importação completa',
      icon: 'ri-team-line',
      to: '/completa',
    }"
  />
</template>
