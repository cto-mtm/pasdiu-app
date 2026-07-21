import pluginVue from 'eslint-plugin-vue'
import vueTsConfigs from '@vue/eslint-config-typescript'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'ios/**', 'android/**'] },
  ...pluginVue.configs['flat/recommended'],
  ...vueTsConfigs(),
]
