# Author Notes Android

Native Android client for the Author Notes local-first notes app.

## Build

```sh
./gradlew :app:assembleDebug
```

The app is implemented with Kotlin and Jetpack Compose. Local changes are saved
first in the on-device SQLite database, then pushed/pulled through the same sync
protocol as the web app.
