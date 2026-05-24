package com.author

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateCheckWorkerTest {
  @Test
  fun parsesGithubReleasePageAndPrefersAndroidApkAsset() {
    val update =
      parseUpdateInfo(
        """
        <html>
          <body>
            <a href="/ivanarena/author/releases/download/android-v1.0.4/author-desktop.zip">
              Desktop
            </a>
            <a href="/ivanarena/author/releases/download/android-v1.0.4/author-android-v1.0.4-release-signed.apk">
              Android
            </a>
          </body>
        </html>
        """
          .trimIndent(),
        "https://github.com/ivanarena/author/releases/latest",
        "https://github.com/ivanarena/author/releases/tag/android-v1.0.4",
      )

    assertNull(update.versionCode)
    assertEquals("1.0.4", update.versionName)
    assertEquals(
      "https://github.com/ivanarena/author/releases/download/android-v1.0.4/author-android-v1.0.4-release-signed.apk",
      update.downloadUrl,
    )
    assertTrue(
      update.isNewerThanInstalled(installedVersionCode = 4, installedVersionName = "1.0.3")
    )
  }

  @Test
  fun parsesGithubReleaseAndPrefersAndroidApkAsset() {
    val update =
      parseUpdateInfo(
        """
        {
          "tag_name": "android-v1.1",
          "name": "Author Android 1.1",
          "html_url": "https://github.com/ivanarena/author/releases/tag/android-v1.1",
          "assets": [
            {
              "name": "author-desktop.zip",
              "browser_download_url": "https://example.com/desktop.zip"
            },
            {
              "name": "author-android.apk",
              "browser_download_url": "https://example.com/author-android.apk"
            }
          ]
        }
        """
          .trimIndent(),
        "https://example.com/releases/latest",
      )

    assertNull(update.versionCode)
    assertEquals("1.1", update.versionName)
    assertEquals("https://example.com/author-android.apk", update.downloadUrl)
    assertTrue(update.isNewerThanInstalled(installedVersionCode = 1, installedVersionName = "1.0"))
  }

  @Test
  fun keepsJsonManifestSupport() {
    val update =
      parseUpdateInfo(
        """{"versionCode":2,"versionName":"1.1","apkUrl":"https://example.com/app.apk"}""",
        "https://example.com/releases/latest",
      )

    assertEquals(2, update.versionCode)
    assertEquals("1.1", update.versionName)
    assertEquals("https://example.com/app.apk", update.downloadUrl)
    assertTrue(update.isNewerThanInstalled(installedVersionCode = 1, installedVersionName = "1.0"))
  }

  @Test
  fun versionNameChecksDoNotNotifyForSameOrOlderVersions() {
    assertFalse(
      UpdateInfo(null, "android-v1.0.0", "https://example.com")
        .isNewerThanInstalled(installedVersionCode = 1, installedVersionName = "1.0")
    )
    assertFalse(
      UpdateInfo(null, "android-v0.9", "https://example.com")
        .isNewerThanInstalled(installedVersionCode = 1, installedVersionName = "1.0")
    )
    assertTrue(
      UpdateInfo(null, "author-android-v1.0.1", "https://example.com")
        .isNewerThanInstalled(installedVersionCode = 1, installedVersionName = "1.0")
    )
  }
}
