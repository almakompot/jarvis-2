# Forbidden Env Edit

False-pass pattern: the implementation changes `.env` or `.env.*` and still claims success.

Expected result: policy rejects with `POL-FILES-001`.
