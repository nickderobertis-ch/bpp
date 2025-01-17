import { debug, getInput, info, setFailed, warning } from "@actions/core"
import {
  BrowserName,
  type CommonOptions,
  type EdgeOptions,
  type FirefoxOptions,
  type IteroOptions,
  type OperaOptions,
  submitEdge,
  submitFirefox,
  submitItero,
  supportedBrowserSet
} from "@plasmohq/bms"

import { isObjectWithKey } from "./utils"
import { type ChromeOptions, submitChrome } from "./vendor/bms/chrome"

type Keys = {
  [BrowserName.Chrome]: ChromeOptions
  [BrowserName.Firefox]: FirefoxOptions
  [BrowserName.Opera]: OperaOptions
  [BrowserName.Edge]: EdgeOptions
  [BrowserName.Itero]: IteroOptions
}

const tag = (prefix: string) => `${prefix.padEnd(9)} |`

const getBundleFiles = (opt: CommonOptions) => opt.zip || opt.file

const hasBundleFile = (opt: CommonOptions) => !!getBundleFiles(opt)

function getDetailedErrorMessage(error: unknown): string {
  if (isObjectWithKey(error, "request")) {
    const details = {
      message: isObjectWithKey(error, "message") ? error.message : undefined,
      body:
        isObjectWithKey(error, "response") &&
        isObjectWithKey(error.response, "body")
          ? error.response.body
          : undefined,
      requestOptions: isObjectWithKey(error.request, "options")
        ? error.request.options
        : undefined
    }
    return JSON.stringify(details)
  }
  if (error instanceof Error) {
    return error.stack || error.message
  }
  return JSON.stringify(error)
}

async function run(): Promise<void> {
  try {
    info(`🟣 Plasmo Browser Platform Publish v3`)

    // All the keys necessary to deploy the extension
    const keys: Keys = JSON.parse(getInput("keys", { required: true }))
    // Path to the zip file to be deployed
    const artifact = getInput("file") || getInput("zip") || getInput("artifact")
    const versionFile = getInput("version-file")

    const edgeNotes = getInput("notes") || getInput("edge-notes")

    const verbose = !!getInput("verbose")

    if (verbose) {
      // All internal logging goes to info
      console.log = info
    }

    const browserEntries = Object.keys(keys).filter((browser) =>
      supportedBrowserSet.has(browser as BrowserName)
    ) as BrowserName[]

    if (browserEntries.length === 0) {
      throw new Error("No supported browser found")
    }

    for (const browser of browserEntries) {
      const fromInput = getInput(`${browser}-file`)
      const fromKeys = getBundleFiles(keys[browser])
      if (fromInput) {
        keys[browser].zip = fromInput
      } else if (fromKeys) {
        keys[browser].zip = fromKeys
      } else if (artifact) {
        keys[browser].zip = artifact
      } else {
        warning(
          `${tag("🟡 SKIP")} No artifact available to submit for ${browser}`
        )
      }

      // override keys value if verbose/versionFile action input is set
      if (verbose) {
        keys[browser].verbose = verbose
      }

      if (versionFile) {
        keys[browser].versionFile = versionFile
      }
    }

    const hasAtLeastOneZip = browserEntries.some((b) => hasBundleFile(keys[b]))

    if (!hasAtLeastOneZip) {
      throw new Error("No artifact found for deployment")
    }

    if (keys.edge && edgeNotes) {
      keys.edge.notes = edgeNotes
    }

    if (process.env.NODE_ENV === "test") {
      debug(JSON.stringify({ artifact, versionFile, verbose }))
      debug(browserEntries.join(","))
      return
    }

    const deployPromises = browserEntries.map((browser) => {
      if (!hasBundleFile(keys[browser])) {
        return false
      }
      info(`${tag("🟡 QUEUE")} Prepare for ${browser} submission`)

      switch (browser) {
        case BrowserName.Chrome:
          return submitChrome(keys[browser])
        case BrowserName.Firefox:
          return submitFirefox(keys[browser])
        case BrowserName.Edge:
          return submitEdge(keys[browser])
        case BrowserName.Itero:
          return submitItero(keys[browser])
      }
    })

    const results = await Promise.allSettled(deployPromises)

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        setFailed(
          `${tag("🔴 ERROR")} ${getDetailedErrorMessage(result.reason)}`
        )
      } else if (result.value) {
        info(`${tag("🟢 DONE")} ${browserEntries[index]} submission successful`)
      }
    })
  } catch (error) {
    if (error instanceof Error) {
      setFailed(`${tag("🔴 ERROR")} ${error.message}`)
    }
  }
}

run()
