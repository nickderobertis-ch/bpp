// Vendored from https://github.com/PlasmoHQ/bms/blob/d5b0aa6f93ff815d6acfdb2d18056fb872b11e0a/src/markets/chrome.ts
import {
  ChromeWebstoreAPI,
  type Options,
  type PublishTarget,
  errorMap
} from "@plasmohq/chrome-webstore-api"
import { strFromU8, unzipSync } from "fflate"
import { existsSync, readFileSync } from "fs"
import { resolve } from "path"
import { cwd } from "process"

import { isObjectWithKey } from "../../utils"

enum BrowserName {
  Chrome = "chrome",
  Firefox = "firefox",
  Opera = "opera",
  Edge = "edge",
  Itero = "itero"
}

type CommonOptions = {
  /**
   * The path to the ZIP, relative from the current working directory (`process.cwd()`)
   * You can use `{version}`, which will be replaced by the `version` entry from your `package.json` or versionFile, e.g. `some-zip-v{version}.zip`
   */
  zip: string

  /**
   * Alias to zip
   */
  file?: string

  /**
   * The path to a json file which has a `version` field. Defaults to `package.json`
   */
  versionFile?: string

  /** If `true`, every step of uploading will be logged to the console. */
  verbose?: boolean

  /** If `true`, it will only upload the zip but does not actually hit submission */
  dryRun?: boolean

  /** Release notes */
  notes?: string
}

const marketNameMap = {
  [BrowserName.Chrome]: "Chrome Web Store",
  [BrowserName.Edge]: "Edge Add-ons",
  [BrowserName.Firefox]: "Firefox Add-ons",
  [BrowserName.Itero]: "Itero TestBed"
  // [BrowserName.Opera]: "Opera Add-ons",
}

const getFullPath = (file: string) => resolve(cwd(), file)

const getIsFileExists = (file: string) => existsSync(getFullPath(file))

function getErrorMessage(market: BrowserName, message: string): string {
  return `${market}: ${message}`
}

const validateOptions = ({
  market = BrowserName.Chrome,
  options = {} as CommonOptions,
  errorMap = {} as Record<string, string>
}) => {
  const requiredFields = Object.keys(errorMap)
  requiredFields.some((key) => {
    if (!options[key]) {
      throw new Error(getErrorMessage(market, errorMap[key]))
    }
  })

  if (!options.zip && !options.file) {
    throw new Error(getErrorMessage(market, "No extension bundle provided"))
  }

  const filePath = options.zip || options.file

  if (!getIsFileExists(filePath)) {
    throw new Error(
      getErrorMessage(
        market,
        `Extension bundle file doesn't exist: ${getFullPath(filePath)}`
      )
    )
  }
}

function getCorrectZip({
  zip = "",
  file = "",
  versionFile = "package.json"
}: CommonOptions): string {
  const output = zip || file

  if (getIsFileExists(versionFile) && output.includes("{version}")) {
    const packageJson = JSON.parse(readFileSync(versionFile).toString())
    return output.replace("{version}", packageJson.version || "")
  } else {
    return output
  }
}

function getManifestJson(zip: string) {
  const fileBuffer = readFileSync(getFullPath(zip))
  const unzip = unzipSync(fileBuffer)
  const manifest = strFromU8(unzip["manifest.json"])
  return JSON.parse(manifest)
}

function logSuccessfullyPublished({
  extId = null as string | number,
  market = "" as BrowserName,
  zip = ""
}) {
  const { name: extName, version: extVersion } = getManifestJson(zip)
  const storeName = marketNameMap[market] || market
  console.log(
    `Successfully updated "${extId}" (${extName}) to version ${extVersion} on ${storeName}!`
  )
}

const verboseStepMap = {} as Record<BrowserName, number>

function getVerboseMessage({
  message = "Message",
  prefix = "",
  market = "" as BrowserName
}): string {
  verboseStepMap[market] = 1 + (verboseStepMap?.[market] ?? 0)
  let msg = `${market}: Step ${verboseStepMap[market]}) ${message}`
  if (prefix !== "Error") {
    prefix = prefix || "Info"
    msg = `${prefix} ${msg}`
  }
  if (prefix === "Info") {
    msg = msg.trim()
  } else if (prefix === "Error") {
    msg = msg.trimStart()
  }
  return msg
}

const verboseLogMap = {} as Record<BrowserName, boolean>

const enableVerboseLogging = (market: BrowserName) => {
  verboseLogMap[market] = true
  process.env.VERBOSE = "true"
}

function getVerboseLogger(market = "" as BrowserName) {
  return (message: string) =>
    verboseLogMap[market] &&
    console.log(
      getVerboseMessage({
        market,
        message
      })
    )
}

const getVerboseError = (
  error: Error,
  market: BrowserName,
  itemId?: string
) => {
  const stackedError = new Error(
    getVerboseMessage({
      market,
      message: `Item "${itemId}": ${error.message}`,
      prefix: "Error"
    })
  )
  stackedError.stack = error.stack
  if (isObjectWithKey(error, "response")) {
    // @ts-expect-error
    stackedError.response = error.response
  }
  if (isObjectWithKey(error, "request")) {
    // @ts-expect-error
    stackedError.request = error.request
  }
  return stackedError
}

export type ChromeOptions = {
  target?: PublishTarget
} & Options &
  CommonOptions

const market = BrowserName.Chrome

const vLog = getVerboseLogger(market)

async function submit({
  extId,
  target = "default",
  zip,
  dryRun,
  ...opts
}: ChromeOptions) {
  const client = new ChromeWebstoreAPI({
    extId,
    ...opts
  })

  vLog(`Updating extension with ID ${extId}`)

  if (dryRun) {
    return true
  }

  try {
    await client.submit({
      filePath: zip,
      target
    })

    logSuccessfullyPublished({ extId, market, zip })

    return true
  } catch (error) {
    const manifest = getManifestJson(zip)
    throw getVerboseError(error, market, `"${extId}" (${manifest.name})`)
  }
}

export async function submitChrome(options: ChromeOptions): Promise<boolean> {
  options.zip = getCorrectZip(options)

  if (options.verbose) {
    enableVerboseLogging(market)
  }

  validateOptions({
    market,
    options,
    errorMap
  })

  return submit(options)
}
