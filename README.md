# Construction Management

## ⚠️ Setting up on a new computer (do this once, right after cloning)

```
git clone https://github.com/anshunovelty-creator/construction-management.git
cd construction-management
git config core.hooksPath .githooks
git config user.name "Anshu Pal"
git config user.email "anshu.novelty@gmail.com"
```

Why:
- `core.hooksPath` turns on the hooks that block commits/pushes made with an Anthropic/Claude identity or attribution.
- `user.email` makes commits show under the **anshunovelty-creator** GitHub account. Without it, the computer's global git email is used.
- On the first push, sign in to GitHub as **anshunovelty-creator** when the browser opens.

Check it worked:

```
git config core.hooksPath   # should print .githooks
git config user.email       # should print anshu.novelty@gmail.com
```
