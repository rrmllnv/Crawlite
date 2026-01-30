import { defaultUserConfig, UserConfig } from '../types/userConfig'

export class UserConfigManager {
  private static instance: UserConfigManager
  private config: UserConfig | null = null
  private isLoaded = false

  private constructor() {}

  static getInstance(): UserConfigManager {
    if (!UserConfigManager.instance) {
      UserConfigManager.instance = new UserConfigManager()
    }
    return UserConfigManager.instance
  }

  async load(): Promise<UserConfig> {
    if (this.isLoaded && this.config) {
      return this.config
    }

    try {
      if (!window.electronAPI?.loadUserConfig) {
        this.config = { ...defaultUserConfig }
        this.isLoaded = true
        return this.config
      }

      const result = await window.electronAPI.loadUserConfig()
      if (result && typeof result === 'object') {
        this.config = this.mergeWithDefaults(result as Partial<UserConfig>)
      } else {
        this.config = { ...defaultUserConfig }
      }

      this.isLoaded = true
      return this.config
    } catch {
      this.config = { ...defaultUserConfig }
      this.isLoaded = true
      return this.config
    }
  }

  async save(config: Partial<UserConfig>): Promise<boolean> {
    try {
      if (this.config) {
        this.config = this.mergeWithDefaults({ ...this.config, ...config })
      } else {
        this.config = this.mergeWithDefaults(config)
      }

      if (!window.electronAPI?.saveUserConfig) {
        return false
      }

      await window.electronAPI.saveUserConfig(this.config)
      return true
    } catch {
      return false
    }
  }

  getConfig(): UserConfig | null {
    return this.config
  }

  async update(updates: Partial<UserConfig>): Promise<boolean> {
    const current = this.config || await this.load()
    return this.save({ ...current, ...updates })
  }

  private mergeWithDefaults(config: Partial<UserConfig>): UserConfig {
    const appPart = config.app || {}
    return {
      app: {
        ...defaultUserConfig.app,
        ...(appPart || {}),
        browserViewLayout: {
          ...defaultUserConfig.app.browserViewLayout,
          ...(((appPart as any)?.browserViewLayout || {}) as Partial<UserConfig['app']['browserViewLayout']>),
        },
        settingsViewLayout: {
          ...defaultUserConfig.app.settingsViewLayout,
          ...(((appPart as any)?.settingsViewLayout || {}) as Partial<UserConfig['app']['settingsViewLayout']>),
        },
      },
      crawling: {
        ...defaultUserConfig.crawling,
        ...(config.crawling || {}),
      },
      sitemap: {
        ...defaultUserConfig.sitemap,
        ...(config.sitemap || {}),
      },
    }
  }
}

export const userConfigManager = UserConfigManager.getInstance()

