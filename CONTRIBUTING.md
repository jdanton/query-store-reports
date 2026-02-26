# Contributing to SQL Server Query Store Reports

Thank you for your interest in contributing to Query Store Reports! This document provides guidelines and information for contributors.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)
- [Questions](#questions)

---

## Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

---

## Getting Started

Before you begin:

1. **Read the documentation** — Familiarize yourself with the [README](README.md) and [DEVELOPMENT](DEVELOPMENT.md) guide.
2. **Check existing issues** — Look through [open issues](https://github.com/jdanton/query-store-reports/issues) to see if your bug or feature has already been reported.
3. **Review open pull requests** — Check [open PRs](https://github.com/jdanton/query-store-reports/pulls) to avoid duplicate work.

---

## Development Setup

### Prerequisites

- **Node.js** 18 or later
- **npm** 9 or later
- **VS Code** 1.85 or later
- **SQL Server 2016+** with Query Store enabled (for testing)

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/jdanton/query-store-reports.git
cd query-store-reports

# Install dependencies
npm install

# Compile the extension
npm run compile
```

### Running the Extension

Press **F5** in VS Code to launch an Extension Development Host with the extension loaded.

### Build Commands

| Command | Purpose |
|---------|---------|
| `npm run compile` | Development build with source maps |
| `npm run build` | Production build (minified, no source maps) |
| `npm run watch` | Watch mode for active development |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed architecture and implementation guidance.

---

## How to Contribute

### Types of Contributions

We welcome contributions in many forms:

- **Bug fixes** — Fix reported issues or bugs you discover
- **New features** — Add new Query Store reports or functionality
- **Documentation** — Improve README, inline comments, or guides
- **Tests** — Add test coverage or improve existing tests
- **Code quality** — Refactor code, improve performance, or fix technical debt

---

## Coding Standards

### TypeScript Guidelines

- Use **TypeScript** for all code (no plain JavaScript)
- Enable strict type checking — the project uses `tsconfig.json` with strict mode
- Avoid `any` types — use specific types or `unknown` when necessary
- Export interfaces for all query parameters and row types

### Code Style

- Use **2 spaces** for indentation (consistent with existing code)
- Use **meaningful variable names** — prefer clarity over brevity
- Add **JSDoc comments** for public APIs and complex logic
- Keep functions **focused and small** — each function should do one thing well

### File Organization

- Query modules belong in `src/queries/`
- Webview code belongs in `webview-src/`
- Tests mirror the structure in `tests/`
- Follow the patterns established in [DEVELOPMENT.md](DEVELOPMENT.md)

### SQL Guidelines

- Use **parameterized queries** — never concatenate user input into SQL strings
- Use appropriate **SQL types** — match mssql driver types (`sql.BigInt`, `sql.DateTimeOffset`, etc.)
- Write **readable SQL** — use consistent formatting and meaningful aliases
- Include **comments** for complex queries or business logic

---

## Testing

### Writing Tests

- All query modules should have corresponding tests in `tests/queries/`
- Use `createMockPool()` from `tests/helpers/mockSql.ts` to mock database connections
- Test parameter binding, SQL structure, and recordset handling
- Plan renderer tests go in `tests/planRenderer.test.ts`

### Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run a specific test file
npx vitest run tests/queries/topResourceConsuming.test.ts
```

### Test Coverage

While we don't enforce a specific coverage percentage, new code should include tests for:

- Parameter validation and type checking
- SQL query structure (key clauses present)
- Error handling
- Edge cases and boundary conditions

---

## Submitting Changes

### Workflow

1. **Fork the repository** and create a new branch from `main`:
   ```bash
   git checkout -b feature/my-new-feature
   ```

2. **Make your changes** following the coding standards above

3. **Write or update tests** to cover your changes

4. **Run the test suite** to ensure nothing breaks:
   ```bash
   npm test
   ```

5. **Test the extension manually** — press F5 and verify your changes work as expected

6. **Commit your changes** with a clear, descriptive message:
   ```bash
   git commit -m "Add support for custom time ranges in regressed queries"
   ```

7. **Push to your fork** and **create a pull request** against `main`

### Pull Request Guidelines

- **Fill out the PR template** completely — it helps reviewers understand your changes
- **Reference related issues** — use "Fixes #123" or "Closes #456" to link issues
- **Keep PRs focused** — each PR should address a single concern
- **Update documentation** if you change public APIs or add features
- **Respond to feedback** — be open to suggestions and requested changes
- **Keep your branch updated** — rebase or merge main periodically to avoid conflicts

### Commit Message Format

Use clear, imperative commit messages:

- ✅ Good: "Add support for Azure AD authentication"
- ✅ Good: "Fix drill-down chart rendering for empty datasets"
- ❌ Bad: "Fixed stuff"
- ❌ Bad: "WIP"

---

## Reporting Bugs

If you find a bug, please [open an issue](https://github.com/jdanton/query-store-reports/issues/new?template=bug_report.yml) using the bug report template.

### Before Submitting

1. **Search existing issues** to avoid duplicates
2. **Confirm Query Store is enabled** on your test database
3. **Check the Developer Console** (Help > Toggle Developer Tools) for error messages
4. **Try the latest version** of the extension

### What to Include

- Clear description of the bug
- Steps to reproduce
- Expected vs. actual behavior
- Screenshots or error logs (if applicable)
- Environment details (OS, VS Code version, SQL Server version, authentication type)

---

## Requesting Features

We welcome feature requests! Please [open an issue](https://github.com/jdanton/query-store-reports/issues/new?template=feature_request.yml) using the feature request template.

### Before Submitting

1. **Search existing issues** to see if the feature has been requested
2. **Review the roadmap** (if available) to see if it's already planned
3. **Consider the scope** — is this feature generally useful or very specific?

### What to Include

- Clear description of the feature
- Use case or problem it solves
- Proposed solution or implementation ideas (optional)
- Alternative approaches considered (optional)

---

## Questions

If you have questions about using the extension or contributing, you can:

- **Check the documentation** — [README](README.md) and [DEVELOPMENT](DEVELOPMENT.md) cover most topics
- **Search closed issues** — your question may have been answered before
- **Open a discussion** — use [GitHub Discussions](https://github.com/jdanton/query-store-reports/discussions) for general questions
- **Open an issue** — if you're unsure whether something is a bug

---

## License

By contributing to Query Store Reports, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

Thank you for contributing! 🎉
