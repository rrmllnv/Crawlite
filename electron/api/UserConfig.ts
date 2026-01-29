import { app } from 'electron'
import path from 'node:path'
import fs from 'fs/promises'
import { CONFIG_FILE_NAME } from '../../src/utils/constants'
import { defaultUserConfig } from '../../src/types/userConfig'

export function getUserConfigPath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, CONFIG_FILE_NAME)
}

export async function loadUserConfig(): Promise<any> {
  try {
    const configPath = getUserConfigPath()
    const data = await fs.readFile(configPath, 'utf-8')
    const trimmed = data.trim()
    if (!trimmed) {
      await saveUserConfig(defaultUserConfig)
      return defaultUserConfig
    }
    try {
      return JSON.parse(trimmed)
    } catch {
      await saveUserConfig(defaultUserConfig)
      return defaultUserConfig
    }
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      await saveUserConfig(defaultUserConfig)
      return defaultUserConfig
    }
    return defaultUserConfig
  }
}

export async function saveUserConfig(userConfig: any): Promise<boolean> {
  try {
    const configPath = getUserConfigPath()
    const configDir = path.dirname(configPath)
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(configPath, JSON.stringify(userConfig, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}

