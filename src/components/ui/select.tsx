"use client"

/**
 * OneVity — shadcn Select dengan KOLOM PENCARIAN global.
 *
 * Semua <Select> di aplikasi otomatis mendapat search bar di atas daftar opsi
 * (bisa dimatikan per-pemakaian dengan <Select searchable={false}>):
 *  - Ketik apa pun saat dropdown terbuka → karakter langsung masuk kolom cari
 *    (typeahead lama Radix dinonaktifkan agar tidak dobel).
 *  - Item & grup difilter live (case-insensitive, cocokkan teks item).
 *  - Group/label ikut tersembunyi bila seluruh isinya tak lolos filter.
 *  - Footer "Tidak ada hasil" bila nol item lolos.
 *  - Keyboard: ArrowUp/Down/Home/End navigasi antar item tampak, Enter/Space
 *    memilih item terfokus (prilaku Radix), Escape menghapus pencarian dulu —
 *    Escape kedua menutup dropdown.
 *  - State pencarian otomatis direset saat dropdown ditutup.
 *  - Teks yang cocok di-HIGHLIGHT lewat CSS Custom Highlight API
 *    (::highlight(select-match)) — range-only, DOM tak diubah sama sekali.
 *    Fallback browser lama: tidak ada highlight (filter tetap jalan normal).
 *
 * Implementasi aman terhadap Radix: handler keydown milik kita dipasang lewat
 * contentProps (dieksekusi SEBELUM handler internal Radix, yang skip bila
 * event sudah defaultPrevented), sehingga typeahead & navigasi bawaan bisa
 * disiapkan tanpa memodifikasi library. Filter dilakukan lewat DOM langsung
 * (display:none + data-filter-hidden) sehingga children pemakai tak diubah.
 */

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useI18n } from "@/onevity/shared/lib/i18n"

// ---------------------------------------------------------------------------
// Task 68 — injeksi runtime rule ::highlight(select-match).
// Parser CSS Turbopack/Lightning CSS tidak mengenali pseudo-element
// ::highlight() (Task 64i) — error parse mematikan seluruh globals.css dan
// menjatuhkan SEMUA halaman (500). Rule yang sama dipasang lewat elemen
// <style> sekali per dokumen: tetap theme-aware (var(--accent-live) di
// :root berubah saat tema aksen berganti) dan tidak pernah membuat app
// crash bila browser tidak mendukung Custom Highlight API.
// ---------------------------------------------------------------------------
if (typeof document !== "undefined" && !document.getElementById("ov-select-match-style")) {
  const style = document.createElement("style")
  style.id = "ov-select-match-style"
  style.textContent =
    "::highlight(select-match){background-color:color-mix(in oklab,var(--accent-live) 24%,transparent);" +
    "color:var(--accent-live-deep);text-decoration:underline;" +
    "text-decoration-color:color-mix(in oklab,var(--accent-live) 55%,transparent);" +
    "text-underline-offset:2px;border-radius:2px;font-weight:600}"
  document.head.appendChild(style)
}

// ---------------------------------------------------------------------------
// Konteks pencarian — satu state query per <Select> (dibagikan ke Content).
// ---------------------------------------------------------------------------
interface SelectSearchCtx {
  query: string
  setQuery: React.Dispatch<React.SetStateAction<string>>
  searchable: boolean
}

const SelectSearchContext = React.createContext<SelectSearchCtx | null>(null)

function Select({
  searchable = true,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root> & {
  /** Tampilkan kolom pencarian di dropdown (default: true). */
  searchable?: boolean
}) {
  const [query, setQuery] = React.useState("")
  const ctx = React.useMemo<SelectSearchCtx>(
    () => ({ query, setQuery, searchable }),
    [query, searchable]
  )
  return (
    <SelectSearchContext.Provider value={ctx}>
      <SelectPrimitive.Root data-slot="select" {...props} />
    </SelectSearchContext.Provider>
  )
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

// ---------------------------------------------------------------------------
// Filter live + navigasi keyboard (DOM langsung, tidak menyentuh children).
// ---------------------------------------------------------------------------
const NAV_KEYS = ["ArrowDown", "ArrowUp", "Home", "End"]

function visibleItems(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>("[data-radix-collection-item]")
  ).filter(
    (n) =>
      n.getAttribute("data-filter-hidden") !== "1" &&
      !n.hasAttribute("data-disabled")
  )
}

function moveFocusVisible(
  root: HTMLElement,
  dir: "up" | "down" | "first" | "last"
): void {
  const items = visibleItems(root)
  if (!items.length) return
  const active = document.activeElement as HTMLElement | null
  const cur = active
    ? items.indexOf(
        active.closest<HTMLElement>("[data-radix-collection-item]") as HTMLElement
      )
    : -1
  const next =
    dir === "first"
      ? 0
      : dir === "last"
        ? items.length - 1
        : dir === "down"
          ? cur < 0
            ? 0
            : (cur + 1) % items.length
          : cur < 0
            ? items.length - 1
            : (cur - 1 + items.length) % items.length
  items[next]?.focus({ preventScroll: true })
}

function SelectContent({
  className,
  children,
  position = "popper",
  ref,
  onKeyDown,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const ctx = React.useContext(SelectSearchContext)
  const searchable = ctx?.searchable ?? false
  const query = ctx?.query ?? ""
  const setQuery = ctx?.setQuery
  const { t } = useI18n()

  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [noResults, setNoResults] = React.useState(false)

  // Highlight teks cocok (CSS Custom Highlight API) — tanpa mengubah DOM.
  // CATATAN: registry menerima objek Highlight (new Highlight(...ranges)),
  // BUKAN Set — salah tipe melempar TypeError & menjatuhkan halaman.
  React.useLayoutEffect(() => {
    const CSSAny = CSS as unknown as {
      highlights?: Map<string, unknown>
      Highlight?: new (...ranges: Range[]) => unknown
    }
    const registry = CSSAny?.highlights
    const HighlightCtor = CSSAny?.Highlight
    if (!registry || typeof HighlightCtor !== "function")
      return // browser tanpa dukungan → filter tetap bekerja normal
    const root = contentRef.current
    const q = query.trim()
    registry.delete("select-match")
    if (!searchable || !root || !q) return
    try {
      const ranges: Range[] = []
      const lower = q.toLowerCase()
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.toLowerCase().includes(lower))
            return NodeFilter.FILTER_REJECT
          const parent = node.parentElement
          if (!parent || parent.closest('[data-slot="select-search"]'))
            return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        },
      })
      let node = walker.nextNode()
      while (node) {
        const value = node.nodeValue ?? ""
        const lowerValue = value.toLowerCase()
        let idx = lowerValue.indexOf(lower)
        while (idx !== -1) {
          // toLowerCase() bisa mengubah panjang (mis. İ → i̇) — indeks
          // melewati batas node akan melempar; lewati node seperti ini.
          const end = idx + q.length
          if (end > value.length) break
          const range = document.createRange()
          range.setStart(node, idx)
          range.setEnd(node, end)
          ranges.push(range)
          idx = lowerValue.indexOf(lower, end)
        }
        node = walker.nextNode()
      }
      if (ranges.length)
        registry.set("select-match", new HighlightCtor(...ranges))
    } catch (err) {
      // Highlight gagal (quirk browser dsb.) → biarkan tanpa highlight,
      // JANGAN pernah menjatuhkan halaman.
      console.error("select search highlight failed:", err)
    }
  }, [query, searchable, noResults, children])

  // Dropdown ditutup → portal unmount → reset query agar buka berikutnya bersih.
  React.useEffect(() => {
    return () => setQuery?.("")
  }, [setQuery])

  // Filter item live berdasarkan query (jalan setelah render, sebelum paint).
  React.useLayoutEffect(() => {
    if (!searchable) return
    const root = contentRef.current
    if (!root) return
    const q = query.trim().toLowerCase()
    const items = Array.from(
      root.querySelectorAll<HTMLElement>("[data-radix-collection-item]")
    )
    let visible = 0
    for (const it of items) {
      const text = (it.textContent ?? "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
      const hit = !q || text.includes(q)
      it.style.display = hit ? "" : "none"
      if (hit) {
        it.removeAttribute("data-filter-hidden")
        visible++
      } else {
        it.setAttribute("data-filter-hidden", "1")
      }
    }
    // Grup: sembunyikan seluruh grup bila tak ada itemnya yang lolos.
    root
      .querySelectorAll<HTMLElement>(
        '[data-slot="select-group"], [role="group"]'
      )
      .forEach((g) => {
        const inside = Array.from(
          g.querySelectorAll<HTMLElement>("[data-radix-collection-item]")
        )
        const any = inside.some(
          (i) => i.getAttribute("data-filter-hidden") !== "1"
        )
        g.style.display = any ? "" : "none"
        if (!any)
          inside.forEach((i) => i.setAttribute("data-filter-hidden", "1"))
      })
    // Label standalone (di luar grup): sembunyikan bila tak ada item tampak
    // di antara label itu dan label/group berikutnya.
    const labels = Array.from(
      root.querySelectorAll<HTMLElement>('[data-slot="select-label"]')
    ).filter((l) => !l.closest('[data-slot="select-group"], [role="group"]'))
    for (const label of labels) {
      if (!q) {
        label.style.display = ""
        continue
      }
      let any = false
      let sib: Element | null = label.nextElementSibling
      while (sib) {
        if (
          sib.hasAttribute("data-slot") &&
          sib.getAttribute("data-slot") === "select-label"
        )
          break
        if (
          sib.matches("[data-radix-collection-item]") &&
          (sib as HTMLElement).getAttribute("data-filter-hidden") !== "1"
        ) {
          any = true
          break
        }
        sib = sib.nextElementSibling
      }
      label.style.display = any ? "" : "none"
    }
    setNoResults(q !== "" && visible === 0)
    // Pulihkan fokus bila item yang sedang difokuskan tertutup filter —
    // tanpa ini, ArrowDown/Enter "mati" karena fokus hilang ke <body>.
    const active = document.activeElement as HTMLElement | null
    if (
      active &&
      (active === document.body ||
        active.getAttribute("data-filter-hidden") === "1")
    ) {
      visibleItems(root)[0]?.focus({ preventScroll: true })
    }
  }, [query, searchable, children])

  // Keydown level content: routing karakter ke kolom cari + navigasi item.
  // Handler internal Radix berjalan SETELAH ini dan skip bila sudah
  // defaultPrevented — jadi typeahead/nav bawaan tidak dobel.
  const handleContentKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>
  ): void => {
    if (!searchable) return
    if (event.defaultPrevented) return // sudah dikonsumsi (mis. Enter/Space memilih item)
    const el = inputRef.current
    const root = contentRef.current
    if (!el || !root) return
    const key = event.key
    const target = event.target as HTMLElement
    const inInput = target === el || el.contains(target)

    // Karakter bebas saat fokus di luar input → masukkan ke kolom cari.
    if (
      !inInput &&
      key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault()
      setQuery?.((prev) => prev + key)
      el.focus({ preventScroll: true })
      return
    }
    // Enter di kolom cari → langsung pilih kandidat teratas (baris pertama
    // yang tampak). Perilaku standar combobox: ketik → Enter → terpilih.
    if (inInput && key === "Enter") {
      const first = visibleItems(root)[0]
      if (first) {
        event.preventDefault()
        try {
          // Bridge ke handler pemilihan Radix pada item (handler item hanya
          // aktif bila event.target = item itu sendiri).
          first.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              bubbles: true,
              cancelable: true,
            })
          )
        } catch {
          first.focus({ preventScroll: true })
        }
      }
      return
    }
    // Navigasi antar item TAMPAK (menggantikan nav Radix yang bisa mendarat
    // di item tersembunyi hasil filter).
    if (NAV_KEYS.includes(key)) {
      // Home/End di dalam input tetap untuk kursor teks, bukan navigasi item.
      if (inInput && (key === "Home" || key === "End")) return
      event.preventDefault()
      moveFocusVisible(
        root,
        key === "ArrowDown"
          ? "down"
          : key === "ArrowUp"
            ? "up"
            : key === "Home"
              ? "first"
              : "last"
      )
    }
  }

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={(node) => {
          contentRef.current = node
          if (typeof ref === "function") ref(node)
          else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
        }}
        data-slot="select-content"
        onKeyDown={(event) => {
          handleContentKeyDown(event)
          onKeyDown?.(event)
        }}
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        {...props}
      >
        {searchable && (
          <div
            data-slot="select-search"
            className="sticky top-0 z-10 border-b bg-popover/95 backdrop-blur-sm"
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery?.(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === "Escape") {
                    // Ada teks → hapus dulu (dropdown tetap terbuka);
                    // kosong → biarkan Radix menutup dropdown.
                    if (e.currentTarget.value) {
                      e.stopPropagation()
                      setQuery?.("")
                    }
                    return
                  }
                  // Karakter biasa saat fokus di input: jangan biarkan jadi
                  // typeahead Radix — cukup masuk ke input.
                  if (e.key.length === 1) e.stopPropagation()
                }}
                placeholder={t("Cari…", "Search…")}
                aria-label={t("Cari opsi", "Search options")}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {query !== "" && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t("Hapus pencarian", "Clear search")}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setQuery?.("")
                    inputRef.current?.focus()
                  }}
                  className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
        {noResults && (
          <div
            data-slot="select-empty"
            className="border-t px-3 py-2.5 text-center text-xs text-muted-foreground select-none"
          >
            {t("Tidak ada hasil", "No matches")}
            {query.trim() ? <>: “{query.trim()}”</> : null}
          </div>
        )}
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
