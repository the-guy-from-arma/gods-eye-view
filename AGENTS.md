# ThunderLink Release Discipline

Every committed or pushed code, UI, configuration, or data update must include
both of these release increments:

1. Increment the public ThunderLink Oblivion build through `0.3.01`, `0.3.02`,
   `0.3.03`, and so on. Do not advance to `0.4.0` until the owner explicitly
   authorizes that version.
2. Increment the TBSGE kernel build once for the same update. The current kernel
   series is `TBSGE-KERNEL-030.xxx`; it resets to the appropriate new series only
   when the owner authorizes a new minor version.

The npm package must use valid SemVer (`0.3.1`, `0.3.2`, and so on), while the
public interface keeps the owner's two-digit build format. Keep `package.json`,
`package-lock.json`, `index.html`, `owner.html`, tests, and `CHANGELOG.md` in sync.

