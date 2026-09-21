# Pinned to Julia 1.12.6: collect_artifacts is a Pkg internal API.
using Pkg, TOML, SHA
target = abspath(ARGS[1])
mkpath(target)
records = Dict{String, Any}("packages" => Dict(), "artifacts" => Dict())
for project in ARGS[2:end]
    Pkg.activate(project)
    Pkg.instantiate(; allow_autoprecomp=false)
    for (uuid, info) in Pkg.dependencies()
        source = info.source
        source === nothing && continue
        source = abspath(source)
        # Standard libraries ship with Julia. Local engine bundles ship in its wheel.
        in_depot = any(d -> startswith(source, joinpath(abspath(d), "packages") * string(Base.Filesystem.path_separator)), DEPOT_PATH)
        in_depot || continue
        destination = joinpath(target, "packages", info.name, basename(source))
        if !isdir(destination)
            mkpath(dirname(destination))
            cp(source, destination)
        end
        records["packages"][string(uuid)] = Dict("name" => info.name, "version" => string(info.version), "tree" => string(info.tree_hash))
        for (toml, artifacts) in Pkg.Operations.collect_artifacts(source; include_lazy=true)
            for (name, meta) in artifacts
                haskey(meta, "git-tree-sha1") || continue
                Pkg.Artifacts.ensure_artifact_installed(name, meta, toml)
                hash = meta["git-tree-sha1"]
                location = Pkg.Artifacts.artifact_path(Base.SHA1(hash))
                destination = joinpath(target, "artifacts", hash)
                if !isdir(destination)
                    println("Staging artifact ", name, " ", hash)
                    mkpath(dirname(destination))
                    cp(location, destination)
                end
                records["artifacts"][hash] = name
            end
        end
    end
end
open(joinpath(target, "inventory.toml"), "w") do io
    TOML.print(io, records; sorted=true)
end
