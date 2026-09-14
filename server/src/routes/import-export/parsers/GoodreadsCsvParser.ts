/**
 * Parses a Goodreads "Export Library" CSV (My Books -> Import and Export,
 * or directly at goodreads.com/review/import - desktop browser only) into
 * `IImportedBook[]`. Goodreads shut down its public API to new integrations
 * in December 2020, so this CSV export is the only supported way left to get
 * a user's library out of Goodreads and into Vaultisse.
 *
 * The "Exclusive Shelf" column - to-read / currently-reading / read - maps
 * onto Vaultisse's own `reading_status` (see `EXCLUSIVE_SHELF_TO_READING_STATUS`
 * below), so a Goodreads import lands each book directly on the matching
 * Library nav filter instead of coming in untracked.
 */
import {parse} from "csv-parse/sync";
import {IImportedBook} from "./IImportedBook";
import {normalizeAndValidateIsbn} from "../../../utils/IsbnVerification";
import {ReadingStatusEnum} from "../../../types/book/IReadingStatus";

/**
 * Raw shape of one row from a Goodreads "Export Library" CSV, keyed by its
 * exact header names. Every field is optional: `relax_column_count` (see
 * `parseGoodreadsCsv` below) lets a row have fewer columns than the header,
 * in which case csv-parse simply omits the trailing keys rather than filling
 * them with empty strings.
 */
interface IGoodreadsCsvRow {
    "Book Id"?: string;
    "Title"?: string;
    "Author"?: string;
    "Author l-f"?: string;
    "Additional Authors"?: string;
    "ISBN"?: string;
    "ISBN13"?: string;
    "My Rating"?: string;
    "Publisher"?: string;
    "Binding"?: string;
    "Number of Pages"?: string;
    "Year Published"?: string;
    "Original Publication Year"?: string;
    "Date Read"?: string;
    "Date Added"?: string;
    "Bookshelves"?: string;
    "Bookshelves with positions"?: string;
    "Exclusive Shelf"?: string;
    "My Review"?: string;
    "Spoiler"?: string;
    "Private Notes"?: string;
    "Read Count"?: string;
    "Owned Copies"?: string;
}

/**
 * Goodreads' "Exclusive Shelf" column - the one shelf every book is on
 * (as opposed to "Bookshelves", which can list several custom shelves at
 * once) - always one of these three values. Anything else (a differently
 * localized export, or a future Goodreads shelf name) is left untracked
 * rather than guessed at.
 */
const EXCLUSIVE_SHELF_TO_READING_STATUS: Record<string, ReadingStatusEnum> = {
    "to-read": ReadingStatusEnum.WANT_TO_READ,
    "currently-reading": ReadingStatusEnum.CURRENTLY_READING,
    "read": ReadingStatusEnum.READ,
};

function toReadingStatus(shelf: string | undefined): ReadingStatusEnum | null {
    const trimmed = shelf?.trim().toLowerCase();
    return trimmed ? EXCLUSIVE_SHELF_TO_READING_STATUS[trimmed] ?? null : null;
}

/**
 * "Bookshelves" lists every shelf a book is on, including its one
 * "Exclusive Shelf" redundantly - a book on "sci-fi" also lists it as
 * "sci-fi" here (or "sci-fi, to-read" if it's on both). Any shelf that
 * isn't one of the three built-in reading-status ones is a custom shelf -
 * on Goodreads these are almost always genre/topic tags (the way most
 * people actually use custom shelves), so they're mapped onto
 * `categoryName` here. `books.category_id` only holds one category, so
 * when a book has several custom shelves only the first (alphabetically,
 * for stable results across runs) is kept - the rest are simply not a
 * Vaultisse category for this book.
 */
function toCategoryName(bookshelves: string | undefined): string | null {
    if (!bookshelves) return null;

    const names = bookshelves
        .split(",")
        .map((raw) => raw.trim())
        .filter((name) => name && !(name.toLowerCase() in EXCLUSIVE_SHELF_TO_READING_STATUS));

    if (names.length === 0) return null;

    names.sort((a, b) => a.localeCompare(b));
    return names[0];
}

/**
 * Goodreads' "Owned Copies" column - how many physical copies of this book
 * the user says they own. Missing/non-numeric/blank defaults to 1 (Goodreads
 * itself defaults new entries to 1), same as adding a book by hand always
 * gets exactly one stock. An explicit "0" is kept as 0 (catalogued but not
 * owned - e.g. a library book) rather than forced up to 1. Capped at 50 to
 * keep a stray typo (or a unit mixup) from creating an absurd number of
 * `book_stocks` rows for one row of the CSV.
 */
function toOwnedCopies(value: string | undefined): number | null {
    const trimmed = value?.trim();
    if (!trimmed) return 1;

    const parsed = parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 1;

    return Math.min(parsed, 50);
}

/**
 * Goodreads wraps ISBN/ISBN13 in an Excel "treat as text" formula
 * (`="1451648537"`, or `=""` when absent) so spreadsheet apps don't mangle
 * leading zeros / drop them as numbers - strip that wrapper before use.
 */
function unwrapExcelFormula(value: string | undefined): string {
    if (!value) return "";
    const match = value.match(/^="(.*)"$/);
    return match ? match[1] : value;
}

/** Common Goodreads `Binding` values that don't literally match a `formats.name` row (see `assets/db/databaseSchema.sql`). */
const BINDING_SYNONYMS: Record<string, string> = {
    "kindle edition": "Electronic",
    "ebook": "Electronic",
    "leather bound": "Leatherbound",
};

function normalizeFormatName(binding: string | undefined): string | null {
    const trimmed = binding?.trim();
    if (!trimmed) return null;
    return BINDING_SYNONYMS[trimmed.toLowerCase()] ?? trimmed;
}

/** `Year Published` (falling back to `Original Publication Year`) is all Goodreads gives us - no month/day. */
function yearToDate(row: IGoodreadsCsvRow): string | null {
    const year = row["Year Published"]?.trim() || row["Original Publication Year"]?.trim();
    return year && /^\d{4}$/.test(year) ? `${year}-01-01` : null;
}

function toPages(value: string | undefined): number | null {
    const pages = parseInt(value ?? "", 10);
    return Number.isFinite(pages) && pages > 0 ? pages : null;
}

function toIsbn(row: IGoodreadsCsvRow): string | null {
    const isbn13 = unwrapExcelFormula(row.ISBN13);
    const isbn10 = unwrapExcelFormula(row.ISBN);
    return normalizeAndValidateIsbn(isbn13) ?? normalizeAndValidateIsbn(isbn10);
}

function toAuthors(row: IGoodreadsCsvRow): string[] {
    const additional = row["Additional Authors"]
        ? row["Additional Authors"].split(",").map((name) => name.trim())
        : [];
    return [row.Author, ...additional]
        .map((name) => name?.trim())
        .filter((name): name is string => !!name);
}

function toDescription(row: IGoodreadsCsvRow): string | null {
    const review = row["My Review"]?.trim();
    if (review) {
        return review;
    }
    const notes = row["Private Notes"]?.trim();
    return notes || null;
}

/**
 * @param csvText Raw file contents (already read into memory by multer).
 * @throws If the file isn't parseable CSV at all - a malformed individual
 *         row still comes through as a row with an empty `name`, which
 *         `ImportRoute.ts` skips and reports rather than failing the batch.
 */
export function parseGoodreadsCsv(csvText: string): IImportedBook[] {
    const rows: IGoodreadsCsvRow[] = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        bom: true,
    });

    return rows.map((row, index) => ({
        row: index + 1,
        name: row.Title?.trim() ?? "",
        isbn: toIsbn(row),
        authors: toAuthors(row),
        publisher: row.Publisher?.trim() || null,
        publishedDate: yearToDate(row),
        pages: toPages(row["Number of Pages"]),
        formatName: normalizeFormatName(row.Binding),
        description: toDescription(row),
        categoryName: toCategoryName(row.Bookshelves),
        readingStatus: toReadingStatus(row["Exclusive Shelf"]),
        ownedCopies: toOwnedCopies(row["Owned Copies"]),
    }));
}
