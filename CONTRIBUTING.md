# Contributing to the Homebranch API

Homebranch development is coordinated in the [Homebranch project repository](https://github.com/Oghamark/homebranch). Follow its [contribution guidelines](https://github.com/Oghamark/homebranch/blob/dev/CONTRIBUTING.md) for the issue process, integrated Docker development environment, pull request expectations, and changes that span components.

## API development

To work on the API as part of the full application, clone the project repository with submodules and start the development stack:

```sh
git clone --recurse-submodules https://github.com/Oghamark/homebranch.git
cd homebranch
cp .env.example .env
docker compose -f docker-compose.dev.yml up
```

The API is available at http://localhost:8080. To run it independently:

```sh
npm ci
npm run start:dev
```

Run the API tests before submitting a pull request:

```sh
npm test
```

Submit API source changes to the [homebranch-api repository](https://github.com/Oghamark/homebranch-api). The Homebranch workspace updates its submodule reference separately after the API change is ready to integrate.
