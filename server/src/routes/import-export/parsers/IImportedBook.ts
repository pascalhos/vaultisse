/**
 * Normalized shape every origin-specific parser (see `GoodreadsCsvParser.ts`)
 * reduces its source file down to, before `ImportRoute.ts` touches the
 * database. Keeping this shared and origin-agnostic is what lets the route
 * stay the same as more origins are added - only a new parser is needed.
 */
import {ReadingStatusEnum} from "../../../types/book/IReadingStatus";

export interface IImportedBook {
    /** Row's 1-based position in the source file, for error reporting. */
    row: number;
    name: string;
    isbn: string | null;
    authors: string[];
    publisher: string | null;
    /** `YYYY-MM-DD`, matching `books.published_date` - only the year is usually known, so `YYYY-01-01`. */
    publishedDate: string | null;
    pages: number | null;
    /** Matched case-insensitively against `formats.name`; `null` if there's no reasonable match. */
    formatName: string | null;
    /** Find-or-created per user, same as `books.category_id`. Optional - origins that have no notion of a genre/category (e.g. Goodreads) just omit it. */
    categoryName?: string | null;
    description?: string | null;
    /** A bare 2-letter code, matching `languages.code` - anything else is dropped by the parser rather than passed through. */
    languageCode?: string | null;
    /**
     * A `data:image/png|jpeg;base64,...` URI or a URL from an allowed host -
     * validated by `ImportRoute.ts` against the same `isAllowedImageUrl()`
     * used everywhere else `books.image_url` is written, not by the parser.
     * `null`/omitted falls back to an ISBN-based Open Library cover lookup.
     */
    imageUrl?: string | null;
    /** The user's personal reading progress for this book (Goodreads' "Exclusive Shelf"), or null/omitted if untracked. */
    readingStatus?: ReadingStatusEnum | null;
    /**
     * Names of physical locations the book should get one "available" stock
     * at each - find-or-created per user, same as `categoryName`. Omitted/empty
     * for an origin with no notion of physical placement - `ImportRoute.ts`
     * then falls back to creating `ownedCopies` location-less stocks instead,
     * so the book still ends up with at least one tracked copy.
     */
    locations?: string[];
    /**
     * How many physical copies of this book the origin says the user owns
     * (Goodreads' "Owned Copies" column). Only consulted by `ImportRoute.ts`
     * when `locations` is empty/omitted - each copy becomes one "available"
     * stock with no location assigned. Omitted/null defaults to 1 (matching
     * the single stock a book gets when added by hand via `BooksRoute.ts`);
     * an origin can pass 0 to explicitly mean "catalogued but not owned".
     */
    ownedCopies?: number | null;
}
