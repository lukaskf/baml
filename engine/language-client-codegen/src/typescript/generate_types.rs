use anyhow::Result;

use internal_baml_core::ir::{repr::IntermediateRepr, ClassWalker, EnumWalker};

use crate::GeneratorArgs;

use super::ToTypeReferenceInClientDefinition;

#[derive(askama::Template)]
#[template(path = "type_builder.js.j2", escape = "none")]
pub(crate) struct TypeBuilder<'ir> {
    enums: Vec<TypescriptEnum<'ir>>,
    classes: Vec<TypescriptClass<'ir>>,
}

#[derive(askama::Template)]
#[template(path = "types.js.j2", escape = "none")]
pub(crate) struct TypescriptTypes<'ir> {
    enums: Vec<TypescriptEnum<'ir>>,
    classes: Vec<TypescriptClass<'ir>>,
}

struct TypescriptEnum<'ir> {
    pub name: &'ir str,
    pub values: Vec<&'ir str>,
    pub dynamic: bool,
}

struct TypescriptClass<'ir> {
    name: &'ir str,
    fields: Vec<(&'ir str, bool, String)>,
    dynamic: bool,
}

impl<'ir> TryFrom<(&'ir IntermediateRepr, &'ir GeneratorArgs)> for TypescriptTypes<'ir> {
    type Error = anyhow::Error;

    fn try_from(
        (ir, _): (&'ir IntermediateRepr, &'ir GeneratorArgs),
    ) -> Result<TypescriptTypes<'ir>> {
        Ok(TypescriptTypes {
            enums: ir
                .walk_enums()
                .map(|e| Into::<TypescriptEnum>::into(&e))
                .collect::<Vec<_>>(),
            classes: ir
                .walk_classes()
                .map(|e| Into::<TypescriptClass>::into(&e))
                .collect::<Vec<_>>(),
        })
    }
}

impl<'ir> TryFrom<(&'ir IntermediateRepr, &'ir GeneratorArgs)> for TypeBuilder<'ir> {
    type Error = anyhow::Error;

    fn try_from((ir, _): (&'ir IntermediateRepr, &'ir GeneratorArgs)) -> Result<TypeBuilder<'ir>> {
        Ok(TypeBuilder {
            enums: ir
                .walk_enums()
                .map(|e| Into::<TypescriptEnum>::into(&e))
                .collect::<Vec<_>>(),
            classes: ir
                .walk_classes()
                .map(|e| Into::<TypescriptClass>::into(&e))
                .collect::<Vec<_>>(),
        })
    }
}

impl<'ir> From<&EnumWalker<'ir>> for TypescriptEnum<'ir> {
    fn from(e: &EnumWalker<'ir>) -> TypescriptEnum<'ir> {
        TypescriptEnum {
            name: e.name(),
            dynamic: e.item.attributes.get("dynamic_type").is_some(),
            values: e
                .item
                .elem
                .values
                .iter()
                .map(|v| v.elem.0.as_str())
                .collect(),
        }
    }
}

impl<'ir> From<&ClassWalker<'ir>> for TypescriptClass<'ir> {
    fn from(c: &ClassWalker<'ir>) -> TypescriptClass<'ir> {
        TypescriptClass {
            name: c.name(),
            dynamic: c.item.attributes.get("dynamic_type").is_some(),
            fields: c
                .item
                .elem
                .static_fields
                .iter()
                .map(|f| {
                    (
                        f.elem.name.as_str(),
                        f.elem.r#type.elem.is_optional(),
                        f.elem.r#type.elem.to_type_ref(&c.db),
                    )
                })
                .collect(),
        }
    }
}
