from baml_client import baml as b
# BAML types get converted to Pydantic models
from baml_client.baml_types import Resume

async def main():
    resume_text = """Jason Doe\nPython, Rust\nUniversity of California, Berkeley, B.S.\nin Computer Science, 2020\nAlso an expert in Tableau, SQL, and C++\n"""

    # this function comes from the autogenerated "baml_client".
    # It calls the LLM you specified and handles the parsing.
    resume = await b.ExtractResume(resume_text)
    
    # Fully type-checked and validated!
    assert isinstance(resume, Resume)