import type { Request, Response } from "express";
/**
 * Apply CORS headers for allow-listed origins and handle the preflight OPTIONS
 * request. Returns `true` if the request was a preflight and has been fully
 * handled (the caller should stop); `false` otherwise (continue routing).
 */
export declare function applyCors(req: Request, res: Response): boolean;
